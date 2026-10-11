// What the session list shows: terminals per environment, grouped by owner.
//
// Shared by the page (through `useSdk()`) and the `bb terminal-hub` CLI
// (through `bb.sdk`), so both list and group terminals the same way (AGENT-3).
// The SDK has no "every terminal" call, and an environment-scoped list leaves
// out thread terminals, so an environment's terminals are its own list plus
// one list per thread in it, archived threads included (LIST-1).

/** The fields of a bb terminal session the hub reads. */
export interface TerminalSession {
  id: string;
  title: string;
  status: string;
  exitCode: number | null;
  threadId: string | null;
  environmentId: string | null;
  hostId: string;
  initialCwd: string;
  cols: number;
  rows: number;
  createdAt: number;
}

/** The fields of a bb thread the hub reads. */
export interface ThreadRecord {
  id: string;
  title: string | null;
  titleFallback?: string | null;
  status: string;
  environmentId: string | null;
  archivedAt: number | null;
  latestAttentionAt: number;
}

type TerminalScope =
  | { kind: "thread"; threadId: string }
  | { kind: "environment"; environmentId: string };

/** The slice of bb's SDK the inventory needs; `useSdk()` and `bb.sdk` both fit. */
export interface InventorySdk {
  terminals: {
    list(args: { scope: TerminalScope }): Promise<{ sessions: TerminalSession[] }>;
  };
  threads: {
    list(args: {
      environmentId?: string;
      projectId?: string;
      archived?: boolean;
      limit?: number;
      offset?: number;
    }): Promise<ThreadRecord[]>;
  };
}

export type ThreadState = "active" | "idle" | "error" | "archived";

export interface HubThread {
  id: string;
  title: string;
  state: ThreadState;
  /** When the thread stopped being active; null while it is active. */
  inactiveSince: number | null;
  /** Orders threads under "From threads", most recent first (LIST-12). */
  activityAt: number;
}

export interface HubRow {
  terminal: TerminalSession;
  /** The owning thread, for thread-scoped terminals. */
  thread: HubThread | null;
  /** Running while its thread is not active (LIST-4). */
  stale: boolean;
}

export interface ThreadGroup {
  thread: HubThread;
  rows: HubRow[];
}

export interface GroupedEnvironment {
  environment: HubRow[];
  threads: ThreadGroup[];
}

/** Everything fetched for one environment, before grouping. */
export interface EnvironmentSnapshot {
  environmentTerminals: TerminalSession[];
  threads: ThreadRecord[];
  /** Thread id → that thread's terminals. */
  threadTerminals: Map<string, TerminalSession[]>;
}

/**
 * LIST-3. `starting` and `stopping` are a turn in progress, so they count as
 * active. `pending` is a thread that has never run, so it counts as idle.
 */
export function threadState(thread: ThreadRecord): ThreadState {
  if (thread.archivedAt !== null) return "archived";
  if (thread.status === "active" || thread.status === "starting" || thread.status === "stopping") {
    return "active";
  }
  if (thread.status === "error") return "error";
  return "idle";
}

/**
 * LIST-4: archived threads stopped at `archivedAt`; others at
 * `latestAttentionAt`. Never `updatedAt`, which moves when a thread is read.
 */
export function toHubThread(thread: ThreadRecord): HubThread {
  const state = threadState(thread);
  return {
    id: thread.id,
    title: thread.title ?? thread.titleFallback ?? "Untitled thread",
    state,
    inactiveSince: state === "active" ? null : (thread.archivedAt ?? thread.latestAttentionAt),
    activityAt: thread.latestAttentionAt,
  };
}

export function isRunning(terminal: Pick<TerminalSession, "status">): boolean {
  return terminal.status === "running" || terminal.status === "starting";
}

const byCreation = (a: HubRow, b: HubRow) => a.terminal.createdAt - b.terminal.createdAt;

/** LIST-2, LIST-4, LIST-12. Threads without terminals are left out. */
export function groupEnvironment(snapshot: EnvironmentSnapshot): GroupedEnvironment {
  const environment = snapshot.environmentTerminals
    .map((terminal): HubRow => ({ terminal, thread: null, stale: false }))
    .sort(byCreation);
  const threads: ThreadGroup[] = [];
  for (const record of snapshot.threads) {
    const terminals = snapshot.threadTerminals.get(record.id) ?? [];
    if (terminals.length === 0) continue;
    const thread = toHubThread(record);
    const rows = terminals
      .map(
        (terminal): HubRow => ({
          terminal,
          thread,
          stale: isRunning(terminal) && thread.state !== "active",
        }),
      )
      .sort(byCreation);
    threads.push({ thread, rows });
  }
  threads.sort((a, b) => b.thread.activityAt - a.thread.activityAt);
  return { environment, threads };
}

/** Rows in display order: "Environment" first, then "From threads". */
export function orderedRows(grouped: GroupedEnvironment): HubRow[] {
  return [...grouped.environment, ...grouped.threads.flatMap((group) => group.rows)];
}

export function runningCount(grouped: GroupedEnvironment): number {
  return orderedRows(grouped).filter((row) => isRunning(row.terminal)).length;
}

const THREAD_PAGE = 200;

/** Every thread matching `filter`, archived ones included (LIST-1). */
export async function listAllThreads(
  sdk: InventorySdk,
  filter: { environmentId: string } | { projectId: string },
): Promise<ThreadRecord[]> {
  const all: ThreadRecord[] = [];
  for (const archived of [false, true]) {
    for (let offset = 0; ; offset += THREAD_PAGE) {
      const page = await sdk.threads.list({ ...filter, archived, limit: THREAD_PAGE, offset });
      all.push(...page);
      if (page.length < THREAD_PAGE) break;
    }
  }
  return all;
}

/** Runs `task` over `items` with at most `limit` in flight. */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export const SCAN_CONCURRENCY = 6;

export async function listEnvironmentTerminals(
  sdk: InventorySdk,
  environmentId: string,
): Promise<TerminalSession[]> {
  const { sessions } = await sdk.terminals.list({ scope: { kind: "environment", environmentId } });
  return sessions;
}

export async function listThreadTerminals(
  sdk: InventorySdk,
  threadId: string,
): Promise<TerminalSession[]> {
  const { sessions } = await sdk.terminals.list({ scope: { kind: "thread", threadId } });
  return sessions;
}

/**
 * The thread terminals of `threads`, fetched with bounded concurrency.
 * `onProgress` gets the number of threads listed so far.
 */
export async function scanThreadTerminals(
  sdk: InventorySdk,
  threads: readonly ThreadRecord[],
  onProgress?: (scanned: number) => void,
): Promise<Map<string, TerminalSession[]>> {
  let scanned = 0;
  const lists = await mapLimited(threads, SCAN_CONCURRENCY, async (thread) => {
    const list = await listThreadTerminals(sdk, thread.id);
    onProgress?.(++scanned);
    return list;
  });
  return new Map(threads.map((thread, index) => [thread.id, lists[index] ?? []]));
}

/** LIST-1: one environment's own terminals plus every thread's in it. */
export async function loadEnvironment(
  sdk: InventorySdk,
  environmentId: string,
): Promise<EnvironmentSnapshot> {
  const [environmentTerminals, threads] = await Promise.all([
    listEnvironmentTerminals(sdk, environmentId),
    listAllThreads(sdk, { environmentId }),
  ]);
  return {
    environmentTerminals,
    threads,
    threadTerminals: await scanThreadTerminals(sdk, threads),
  };
}
