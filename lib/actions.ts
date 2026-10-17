// What the tabs' and the bar's actions do, and their guard rails.
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

/** LIST-32: how soon after the user typed into the view an exit counts as theirs. */
export const ENDED_HERE_MS = 5_000;

/** LIST-32: the user ended this terminal from its view. */
export function endedHere(typedAgoMs: number | null): boolean {
  return typedAgoMs !== null && typedAgoMs <= ENDED_HERE_MS;
}

/** ACT-7: the tab to the right of the closed one, else the one to its left, else none. */
export function nextSelection(order: readonly string[], closedId: string): string | null {
  const index = order.indexOf(closedId);
  if (index === -1) return null;
  return order[index + 1] ?? order[index - 1] ?? null;
}
