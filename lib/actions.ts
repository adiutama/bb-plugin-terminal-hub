// What the row menu and the bulk cleanup do, and their guard rails.
import { type HubRow, isRunning, type TerminalSession } from "./inventory";

export interface ActionsSdk {
  terminals: {
    close(args: { terminalId: string; mode: "force" | "if-clean" }): Promise<TerminalSession>;
    rename(args: { terminalId: string; title: string }): Promise<TerminalSession>;
    restart(args: { terminalId: string }): Promise<TerminalSession>;
  };
}

/**
 * ACT-4: environment-scoped terminals count as the hub's (ADR 202610101645)
 * and close without asking; thread terminals belong to someone else.
 */
export function needsConfirmation(row: HubRow): boolean {
  return row.terminal.threadId !== null;
}

/** ACT-5: every running thread terminal whose thread is not active. */
export function settledTargets(rows: readonly HubRow[]): HubRow[] {
  return rows.filter(
    (row) => row.thread !== null && row.thread.state !== "active" && isRunning(row.terminal),
  );
}

export class CloseFailedError extends Error {}

/**
 * ACT-6: force mode, then check the result. `if-clean` silently leaves a
 * terminal running once it has had input, so it is never used here.
 */
export async function closeTerminal(sdk: ActionsSdk, terminalId: string): Promise<TerminalSession> {
  const session = await sdk.terminals.close({ terminalId, mode: "force" });
  if (isRunning(session)) {
    throw new CloseFailedError(`${session.title || terminalId} is still running`);
  }
  return session;
}

export interface BulkCloseResult {
  closed: string[];
  failed: { row: HubRow; message: string }[];
}

/** ACT-5: closes each target, collecting failures instead of stopping at one. */
export async function closeAll(sdk: ActionsSdk, rows: readonly HubRow[]): Promise<BulkCloseResult> {
  const result: BulkCloseResult = { closed: [], failed: [] };
  await Promise.all(
    rows.map(async (row) => {
      try {
        await closeTerminal(sdk, row.terminal.id);
        result.closed.push(row.terminal.id);
      } catch (error) {
        result.failed.push({
          row,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
  return result;
}

/** ACT-2. */
export async function renameTerminal(
  sdk: ActionsSdk,
  terminalId: string,
  title: string,
): Promise<TerminalSession> {
  return sdk.terminals.rename({ terminalId, title: title.trim() });
}

/**
 * ACT-3: bb's restart replaces the process with a new interactive shell in the
 * same scope. The returned session may carry a new id; callers select it.
 */
export async function restartTerminal(
  sdk: ActionsSdk,
  terminalId: string,
): Promise<TerminalSession> {
  return sdk.terminals.restart({ terminalId });
}

/** ACT-7: the terminal after the closed one, in display order, or none. */
export function nextSelection(order: readonly string[], closedId: string): string | null {
  const index = order.indexOf(closedId);
  if (index === -1) return null;
  return order[index + 1] ?? null;
}
