// An in-memory bb for store, page, and CLI tests: projects, environments,
// threads, and terminals that behave like bb 0.46.0 as recorded in
// docs/findings (exited terminals vanish from `list`; `get` still finds them;
// an environment list leaves out thread terminals).
import { vi } from "vitest";
import type { TerminalSession, ThreadRecord } from "../../lib/inventory";

export interface FakeThread extends ThreadRecord {
  projectId: string;
}

export interface FakeEnvironment {
  id: string;
  projectId: string;
  name: string | null;
  branchName: string | null;
  path: string | null;
  hostId: string;
  status: string;
}

export interface World {
  projects: { id: string; name: string }[];
  environments: FakeEnvironment[];
  threads: FakeThread[];
  terminals: TerminalSession[];
  homes: Record<string, string>;
  output: Record<string, string>;
}

let seq = 0;

export function terminal(overrides: Partial<TerminalSession> & { id: string }): TerminalSession {
  seq += 1;
  return {
    title: overrides.id,
    status: "running",
    exitCode: null,
    threadId: null,
    environmentId: "env_a",
    hostId: "host_1",
    initialCwd: "/Users/me/repo",
    cols: 80,
    rows: 24,
    createdAt: 1_000 + seq,
    ...overrides,
  };
}

export function thread(overrides: Partial<FakeThread> & { id: string }): FakeThread {
  return {
    title: `Thread ${overrides.id}`,
    status: "idle",
    environmentId: "env_a",
    archivedAt: null,
    latestAttentionAt: 1_000,
    projectId: "proj_1",
    ...overrides,
  };
}

export function world(overrides: Partial<World> = {}): World {
  return {
    projects: [{ id: "proj_1", name: "Project one" }],
    environments: [
      {
        id: "env_a",
        projectId: "proj_1",
        name: null,
        branchName: "main",
        path: "/Users/me/repo",
        hostId: "host_1",
        status: "ready",
      },
    ],
    threads: [],
    terminals: [],
    homes: { host_1: "/Users/me" },
    output: {},
    ...overrides,
  };
}

const live = (status: string) => status === "running" || status === "starting";

export function notFound(): Error {
  return Object.assign(new Error("Terminal session not found"), {
    code: "terminal_not_found",
    status: 404,
  });
}

/** A fake `useSdk()` / `bb.sdk` over `w`. Every method is a vi.fn. */
export function fakeSdk(w: World) {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  let created = 0;
  // Output per terminal, numbered like bb's ring buffer. `w.output` seeds it.
  const streams = new Map<string, { seq: number; text: string }[]>();
  const streamOf = (terminalId: string) => {
    let chunks = streams.get(terminalId);
    if (!chunks) {
      const seed = w.output[terminalId];
      chunks = seed ? [{ seq: 1, text: seed }] : [];
      streams.set(terminalId, chunks);
    }
    return chunks;
  };
  const find = (terminalId: string) => {
    const found = w.terminals.find((t) => t.id === terminalId);
    if (!found) throw notFound();
    return found;
  };
  const sdk = {
    terminals: {
      list: vi.fn(async ({ scope }: { scope: { kind: string; [key: string]: string } }) => ({
        sessions: w.terminals
          .filter(
            (t) =>
              live(t.status) &&
              (scope.kind === "thread"
                ? t.threadId === scope.threadId
                : t.threadId === null && t.environmentId === scope.environmentId),
          )
          .map((t) => ({ ...t })),
      })),
      get: vi.fn(async ({ terminalId }: { terminalId: string }) => ({ ...find(terminalId) })),
      output: vi.fn(
        async ({
          terminalId,
          sinceSeq,
          tailBytes,
        }: {
          terminalId: string;
          sinceSeq?: number;
          tailBytes?: number;
        }) => {
          const session = find(terminalId);
          const chunks = streamOf(terminalId);
          const from = tailBytes !== undefined ? 0 : (sinceSeq ?? 0);
          return {
            chunks: chunks
              .filter((chunk) => chunk.seq > from)
              .map((chunk) => ({
                seq: chunk.seq,
                dataBase64: Buffer.from(chunk.text).toString("base64"),
              })),
            nextSeq: chunks.at(-1)?.seq ?? 0,
            truncated: false,
            status: session.status,
            exitCode: session.exitCode,
            closeReason: null,
          };
        },
      ),
      create: vi.fn(
        async (args: {
          cols: number;
          rows: number;
          scope: { kind: string; environmentId?: string; threadId?: string };
          title?: string;
        }) => {
          created += 1;
          const session = terminal({
            id: `term_new_${created}`,
            title: args.title ?? "zsh",
            environmentId: args.scope.environmentId ?? "env_a",
            threadId: args.scope.threadId ?? null,
            cols: args.cols,
            rows: args.rows,
          });
          w.terminals.push(session);
          return { ...session };
        },
      ),
      close: vi.fn(async ({ terminalId }: { terminalId: string; mode: string }) => {
        const session = find(terminalId);
        session.status = "exited";
        session.exitCode = null;
        return { ...session };
      }),
      rename: vi.fn(async ({ terminalId, title }: { terminalId: string; title: string }) => {
        const session = find(terminalId);
        session.title = title;
        return { ...session };
      }),
      restart: vi.fn(async ({ terminalId }: { terminalId: string }) => {
        const session = find(terminalId);
        session.status = "running";
        session.exitCode = null;
        return { ...session };
      }),
      input: vi.fn(async ({ terminalId }: { terminalId: string }) => ({ ...find(terminalId) })),
      resize: vi.fn(
        async ({ terminalId, cols, rows }: { terminalId: string; cols: number; rows: number }) => {
          const session = find(terminalId);
          session.cols = cols;
          session.rows = rows;
          return { ...session };
        },
      ),
    },
    threads: {
      list: vi.fn(
        async (args: {
          environmentId?: string;
          projectId?: string;
          archived?: boolean;
          limit?: number;
          offset?: number;
        }) => {
          const rows = w.threads.filter(
            (t) =>
              (args.environmentId === undefined || t.environmentId === args.environmentId) &&
              (args.projectId === undefined || t.projectId === args.projectId) &&
              (t.archivedAt !== null) === (args.archived ?? false),
          );
          const offset = args.offset ?? 0;
          return rows.slice(offset, offset + (args.limit ?? 50)).map((t) => ({ ...t }));
        },
      ),
      get: vi.fn(async ({ threadId }: { threadId: string }) => {
        const found = w.threads.find((t) => t.id === threadId);
        if (!found) throw Object.assign(new Error("Thread not found"), { status: 404 });
        return { ...found };
      }),
    },
    environments: {
      list: vi.fn(async ({ projectId }: { projectId?: string } = {}) =>
        w.environments.filter((e) => projectId === undefined || e.projectId === projectId),
      ),
    },
    projects: { list: vi.fn(async () => w.projects) },
    hosts: {
      directory: vi.fn(async ({ hostId }: { hostId: string }) => {
        const home = w.homes[hostId];
        if (!home) throw new Error("Host offline");
        return { directory: home, parent: null, entries: [] };
      }),
    },
    subscribe: vi.fn((args: { event: string; callback: (event: any) => void }) => {
      let set = listeners.get(args.event);
      if (!set) {
        set = new Set();
        listeners.set(args.event, set);
      }
      set.add(args.callback);
      return () => {
        set.delete(args.callback);
      };
    }),
  };
  return {
    sdk,
    /** The shell writes `text`. */
    write(terminalId: string, text: string) {
      const chunks = streamOf(terminalId);
      chunks.push({ seq: (chunks.at(-1)?.seq ?? 0) + 1, text });
    },
    /** Fires bb's `thread:changed` realtime event. */
    emitThreadChanged(event: {
      id: string;
      changes: string[];
      metadata?: {
        projectId?: string;
        statusChange?: { status: string; latestAttentionAt: number };
      };
    }) {
      emit("thread:changed", { entity: "thread", ...event });
    },
    /** Fires bb's `environment:changed` realtime event. */
    emitEnvironmentChanged(event: { id: string; changes: string[] }) {
      emit("environment:changed", { entity: "environment", ...event });
    },
    /** Fires bb's `realtime:connection` event. */
    emitConnection(event: {
      state: "connected" | "connecting" | "disconnected";
      reconnected: boolean;
    }) {
      emit("realtime:connection", { reconnectDelayMs: null, ...event });
    },
  };
}

/** Lets pending promises and zero-delay timers settle. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
