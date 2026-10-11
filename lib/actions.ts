// What the row menu and the bulk cleanup do, and their guard rails.
import { isNotFound } from "./errors";
import {
  type HubRow,
  isRunning,
  type TerminalSession,
  type ThreadRecord,
  threadState,
} from "./inventory";

export interface ActionsSdk {
  terminals: {
    close(args: { terminalId: string; mode: "force" | "if-clean" }): Promise<TerminalSession>;
    rename(args: { terminalId: string; title: string }): Promise<TerminalSession>;
    restart(args: { terminalId: string }): Promise<TerminalSession>;
  };
}

/** ACT-5: what the bulk cleanup checks again before it closes anything. */
export interface VerifySdk {
  terminals: { get(args: { terminalId: string }): Promise<TerminalSession> };
  threads: { get(args: { threadId: string }): Promise<ThreadRecord> };
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
  /** No longer stale when checked again: exited, gone, or its thread became active. */
  skipped: HubRow[];
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * ACT-5: checks each confirmed target again, then closes the ones still
 * stale, collecting failures instead of stopping at one. A target that cannot
 * be checked is a failure and stays open.
 */
export async function closeAll(
  sdk: ActionsSdk & VerifySdk,
  rows: readonly HubRow[],
): Promise<BulkCloseResult> {
  const result: BulkCloseResult = { closed: [], failed: [], skipped: [] };
  // A deleted thread is not active; its terminals are left behind.
  const active = (threadId: string) =>
    sdk.threads.get({ threadId }).then(
      (thread) => threadState(thread) === "active",
      (error: unknown) => {
        if (isNotFound(error)) return false;
        throw error;
      },
    );
  await Promise.all(
    rows.map(async (row) => {
      try {
        const session = await sdk.terminals
          .get({ terminalId: row.terminal.id })
          .catch((error: unknown) => {
            if (isNotFound(error)) return null;
            throw error;
          });
        if (session === null || !isRunning(session)) {
          result.skipped.push(row);
          return;
        }
        // The thread last, right before the close: it may have just woken up.
        const threadId = row.terminal.threadId;
        if (threadId !== null && (await active(threadId))) {
          result.skipped.push(row);
          return;
        }
      } catch (error) {
        result.failed.push({ row, message: errorMessage(error) });
        return;
      }
      try {
        await closeTerminal(sdk, row.terminal.id);
        result.closed.push(row.terminal.id);
      } catch (error) {
        result.failed.push({ row, message: errorMessage(error) });
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
