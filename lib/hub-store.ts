// The Terminals page's data: what is listed, kept fresh on its own cadence.
//
// One store per open page. The title-bar count (NAV-6) reads the same store
// through `activeHubStore`, so the header never polls on its own.
import { type ActionsSdk, type BulkCloseResult, closeAll, closeTerminal } from "./actions";
import {
  type EnvironmentSnapshot,
  type GroupedEnvironment,
  groupEnvironment,
  type HubRow,
  type InventorySdk,
  isRunning,
  listAllThreads,
  listEnvironmentTerminals,
  listThreadTerminals,
  loadEnvironment,
  mapLimited,
  orderedRows,
  runningCount,
  SCAN_CONCURRENCY,
  scanThreadTerminals,
  type TerminalSession,
  type ThreadRecord,
} from "./inventory";
import { ALL } from "./route";
import { findServerHint, HINT_TAIL_BYTES, OutputTail, type ServerHint } from "./server-hint";
import { base64ToBytes } from "./terminal-io";
import type { TransportSdk } from "./terminal-transport";

/** LIST-8, LIST-14: environment terminals; also the whole single-environment view. */
export const FAST_REFRESH_MS = 5_000;
/** LIST-14: full rescan of every thread's terminals in the All view. */
export const SCAN_REFRESH_MS = 30_000;
/** Coalesces bursts of thread change signals into one refresh. */
export const SIGNAL_DEBOUNCE_MS = 250;

export interface EnvironmentRecord {
  id: string;
  name: string | null;
  branchName?: string | null;
  path: string | null;
  hostId: string;
  status: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
}

export interface ThreadChangedEvent {
  id?: string;
  changes: readonly string[];
  metadata?: { projectId?: string };
}

export interface HubSdk extends InventorySdk, ActionsSdk {
  terminals: {
    get(args: { terminalId: string }): Promise<TerminalSession>;
    output(args: {
      terminalId: string;
      sinceSeq?: number;
      tailBytes?: number;
    }): Promise<{ chunks: { dataBase64: string }[] }>;
    create(args: {
      cols: number;
      rows: number;
      scope: { kind: "environment"; environmentId: string };
      start?: { mode: "shell" };
    }): Promise<TerminalSession>;
  } & InventorySdk["terminals"] &
    ActionsSdk["terminals"] &
    TransportSdk["terminals"];
  threads: InventorySdk["threads"] & {
    get(args: { threadId: string }): Promise<ThreadRecord>;
  };
  environments: { list(args: { projectId: string }): Promise<EnvironmentRecord[]> };
  projects: { list(): Promise<ProjectRecord[]> };
  hosts: { directory(args: { hostId: string }): Promise<{ directory: string }> };
  subscribe(args: {
    event: "thread:changed";
    callback: (event: ThreadChangedEvent) => void;
  }): () => void;
}

export interface EnvironmentInfo {
  id: string;
  name: string;
  path: string;
  hostId: string;
}

export interface Section {
  environment: EnvironmentInfo;
  grouped: GroupedEnvironment;
  running: number;
  /** False until this environment's terminals were listed once. */
  loaded: boolean;
}

export interface HubView {
  projectId: string | null;
  environment: string;
  projects: ProjectRecord[] | null;
  environments: EnvironmentInfo[] | null;
  /** One section for a single environment; every environment for All. */
  sections: Section[];
  /** Every listed row in display order, across sections. */
  rows: HubRow[];
  running: number;
  hints: ReadonlyMap<string, ServerHint>;
  homes: ReadonlyMap<string, string | null>;
  error: string | null;
}

interface Retained {
  terminal: TerminalSession;
  thread: ThreadRecord | null;
}

export function environmentName(env: EnvironmentRecord): string {
  if (env.name) return env.name;
  if (env.branchName) return env.branchName;
  return env.path?.split("/").filter(Boolean).pop() ?? env.id;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Listener = () => void;

export class HubStore {
  private projectId: string | null = null;
  private environment: string = ALL;
  private generation = 0;
  private projects: ProjectRecord[] | null = null;
  private environments: EnvironmentRecord[] | null = null;
  private environmentTerminals = new Map<string, TerminalSession[]>();
  private threads = new Map<string, ThreadRecord>();
  private threadTerminals = new Map<string, TerminalSession[]>();
  /** LIST-11: terminals seen running that have since exited. */
  private retained = new Map<string, Retained>();
  /** Closed or dismissed here: never retained or re-shown as exited. */
  private gone = new Set<string>();
  private hints = new Map<string, ServerHint>();
  private hintRequested = new Set<string>();
  private tails = new Map<string, OutputTail>();
  private homes = new Map<string, string | null>();
  private error: string | null = null;
  private view: HubView;
  private listeners = new Set<Listener>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private signalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private unsubscribe: (() => void) | null = null;
  private started = false;
  private disposed = false;

  constructor(private readonly sdk: HubSdk) {
    this.view = this.computeView();
  }

  // ── subscription ────────────────────────────────────────────────────────

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = (): HubView => this.view;

  private emit(): void {
    if (this.disposed) return;
    this.view = this.computeView();
    for (const listener of this.listeners) listener();
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.unsubscribe = this.sdk.subscribe({
      event: "thread:changed",
      callback: (event) => this.onThreadChanged(event),
    });
    document.addEventListener("visibilitychange", this.onVisibility);
    void this.loadProjects();
    this.restartTimers(true);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    for (const timer of this.signalTimers.values()) clearTimeout(timer);
    this.signalTimers.clear();
    this.unsubscribe?.();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.listeners.clear();
    if (activeStore === this) setActiveHubStore(null);
  }

  /** Points the store at a project and environment (or `all`). */
  select(projectId: string | null, environment: string): void {
    if (projectId === this.projectId && environment === this.environment) return;
    if (projectId !== this.projectId) {
      this.generation++;
      this.environments = null;
      this.environmentTerminals.clear();
      this.threads.clear();
      this.threadTerminals.clear();
      this.retained.clear();
      this.error = null;
    }
    this.projectId = projectId;
    this.environment = environment;
    this.emit();
    if (this.started) this.restartTimers(true);
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === "visible") this.restartTimers(true);
    else this.clearTimers();
  };

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** Re-arms the refresh cadence; with `now`, also refreshes immediately. */
  private restartTimers(now: boolean): void {
    this.clearTimers();
    if (this.disposed || this.projectId === null) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const fast = () => {
      void (this.environment === ALL ? this.refreshEnvironmentScopes() : this.refreshEnvironment());
      this.timers[0] = setTimeout(fast, FAST_REFRESH_MS);
    };
    const scan = () => {
      void this.scanProject();
      this.timers[1] = setTimeout(scan, SCAN_REFRESH_MS);
    };
    if (now) {
      if (this.environment === ALL) {
        // The first fast tick needs the environment list, which the scan loads.
        void this.scanProject().then(() => this.refreshEnvironmentScopes());
        this.timers[0] = setTimeout(fast, FAST_REFRESH_MS);
        this.timers[1] = setTimeout(scan, SCAN_REFRESH_MS);
      } else {
        void this.loadEnvironments();
        fast();
      }
    } else {
      this.timers[0] = setTimeout(fast, FAST_REFRESH_MS);
      if (this.environment === ALL) this.timers[1] = setTimeout(scan, SCAN_REFRESH_MS);
    }
  }

  // ── loading ─────────────────────────────────────────────────────────────

  private async loadProjects(): Promise<void> {
    try {
      this.projects = await this.sdk.projects.list();
      this.emit();
    } catch (error) {
      this.error = message(error);
      this.emit();
    }
  }

  private async loadEnvironments(): Promise<void> {
    const projectId = this.projectId;
    const generation = this.generation;
    if (projectId === null) return;
    try {
      const environments = await this.sdk.environments.list({ projectId });
      if (generation !== this.generation) return;
      this.environments = environments.filter((env) => env.status !== "destroyed");
      for (const env of this.environments) this.requestHome(env.hostId);
      this.emit();
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = message(error);
      this.emit();
    }
  }

  /** LIST-8: the selected environment, all of it. */
  async refreshEnvironment(): Promise<void> {
    const environmentId = this.environment;
    const generation = this.generation;
    if (this.projectId === null || environmentId === ALL) return;
    try {
      const snapshot = await loadEnvironment(this.sdk, environmentId);
      if (generation !== this.generation) return;
      this.mergeEnvironment(environmentId, snapshot);
      this.error = null;
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = message(error);
    }
    this.emit();
  }

  /** LIST-14: every environment's own terminals. */
  async refreshEnvironmentScopes(): Promise<void> {
    const generation = this.generation;
    const environments = this.environments ?? [];
    const lists = await mapLimited(environments, SCAN_CONCURRENCY, async (env) => {
      try {
        return await listEnvironmentTerminals(this.sdk, env.id);
      } catch {
        return null;
      }
    });
    if (generation !== this.generation) return;
    environments.forEach((env, index) => {
      const list = lists[index];
      if (list) this.replaceEnvironmentTerminals(env.id, list);
    });
    this.emit();
  }

  /** LIST-14: the full scan of every thread in the project. */
  async scanProject(): Promise<void> {
    const projectId = this.projectId;
    const generation = this.generation;
    if (projectId === null) return;
    try {
      await this.loadEnvironments();
      const threads = await listAllThreads(this.sdk, { projectId });
      const terminals = await scanThreadTerminals(this.sdk, threads);
      if (generation !== this.generation) return;
      this.threads = new Map(threads.map((thread) => [thread.id, thread]));
      for (const id of [...this.threadTerminals.keys()]) {
        if (!terminals.has(id)) this.replaceThreadTerminals(id, []);
      }
      for (const [id, list] of terminals) this.replaceThreadTerminals(id, list);
      this.error = null;
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = message(error);
    }
    this.emit();
  }

  /** LIST-14: one thread, at once, when bb says its terminals changed. */
  async refreshThread(threadId: string): Promise<void> {
    const generation = this.generation;
    try {
      const [thread, list] = await Promise.all([
        this.sdk.threads.get({ threadId }),
        listThreadTerminals(this.sdk, threadId),
      ]);
      if (generation !== this.generation) return;
      this.threads.set(thread.id, thread);
      this.replaceThreadTerminals(threadId, list);
      this.emit();
    } catch {
      // A deleted thread or a hiccup: the next scan settles it.
    }
  }

  private onThreadChanged(event: ThreadChangedEvent): void {
    const id = event.id;
    if (this.projectId === null || id === undefined) return;
    const known = this.threads.get(id);
    const inProject = known !== undefined || event.metadata?.projectId === this.projectId;
    if (!inProject) return;
    if (this.environment !== ALL) {
      if (known && known.environmentId !== this.environment && !this.threadTerminals.has(id)) {
        return;
      }
      this.debounce("environment", () => void this.refreshEnvironment());
    } else {
      this.debounce(id, () => void this.refreshThread(id));
    }
  }

  private debounce(key: string, run: () => void): void {
    const pending = this.signalTimers.get(key);
    if (pending) clearTimeout(pending);
    this.signalTimers.set(
      key,
      setTimeout(() => {
        this.signalTimers.delete(key);
        if (!this.disposed) run();
      }, SIGNAL_DEBOUNCE_MS),
    );
  }

  // ── merging ─────────────────────────────────────────────────────────────

  private mergeEnvironment(environmentId: string, snapshot: EnvironmentSnapshot): void {
    this.replaceEnvironmentTerminals(environmentId, snapshot.environmentTerminals);
    for (const [id, thread] of this.threads) {
      if (thread.environmentId === environmentId && !snapshot.threadTerminals.has(id)) {
        this.threads.delete(id);
        this.replaceThreadTerminals(id, []);
      }
    }
    for (const thread of snapshot.threads) this.threads.set(thread.id, thread);
    for (const [id, list] of snapshot.threadTerminals) this.replaceThreadTerminals(id, list);
  }

  private replaceEnvironmentTerminals(environmentId: string, list: TerminalSession[]): void {
    const previous = this.environmentTerminals.get(environmentId) ?? [];
    this.environmentTerminals.set(environmentId, list);
    this.noticeChanges(previous, list, null);
  }

  private replaceThreadTerminals(threadId: string, list: TerminalSession[]): void {
    const previous = this.threadTerminals.get(threadId) ?? [];
    if (list.length === 0) this.threadTerminals.delete(threadId);
    else this.threadTerminals.set(threadId, list);
    this.noticeChanges(previous, list, this.threads.get(threadId) ?? null);
  }

  /** New terminals get a one-time hint read; vanished running ones are checked. */
  private noticeChanges(
    previous: readonly TerminalSession[],
    next: readonly TerminalSession[],
    thread: ThreadRecord | null,
  ): void {
    const ids = new Set(next.map((terminal) => terminal.id));
    for (const terminal of next) {
      this.requestHome(terminal.hostId);
      if (isRunning(terminal)) this.requestHint(terminal.id);
    }
    for (const terminal of previous) {
      if (!ids.has(terminal.id) && isRunning(terminal) && !this.gone.has(terminal.id)) {
        void this.checkExited(terminal, thread);
      }
    }
  }

  /** LIST-11: a listed terminal vanished; keep it if it exited. */
  private async checkExited(terminal: TerminalSession, thread: ThreadRecord | null): Promise<void> {
    const generation = this.generation;
    try {
      const session = await this.sdk.terminals.get({ terminalId: terminal.id });
      if (generation !== this.generation || this.gone.has(terminal.id)) return;
      if (session.status === "exited") {
        this.retained.set(terminal.id, { terminal: session, thread });
        this.emit();
      }
    } catch {
      // Gone without a trace: nothing to show.
    }
  }

  /** LIST-7: read a terminal's last 4 KB once, when it first appears. */
  private requestHint(terminalId: string): void {
    if (this.hintRequested.has(terminalId)) return;
    this.hintRequested.add(terminalId);
    void this.sdk.terminals
      .output({ terminalId, tailBytes: HINT_TAIL_BYTES })
      .then((output) => {
        const tail = this.tailFor(terminalId);
        for (const chunk of output.chunks) tail.push(base64ToBytes(chunk.dataBase64));
        this.updateHint(terminalId);
      })
      .catch(() => {});
  }

  /** LIST-7: output the view received for a terminal it is showing. */
  pushOutput(terminalId: string, bytes: Uint8Array): void {
    this.tailFor(terminalId).push(bytes);
    this.updateHint(terminalId);
  }

  private tailFor(terminalId: string): OutputTail {
    let tail = this.tails.get(terminalId);
    if (!tail) {
      tail = new OutputTail();
      this.tails.set(terminalId, tail);
    }
    return tail;
  }

  private updateHint(terminalId: string): void {
    const hint = findServerHint(this.tailFor(terminalId).text());
    const current = this.hints.get(terminalId);
    if (hint === null || (current && current.url === hint.url)) return;
    this.hints.set(terminalId, hint);
    this.emit();
  }

  /** LIST-6: the host's home directory, so paths can show `~`. */
  private requestHome(hostId: string): void {
    if (this.homes.has(hostId)) return;
    this.homes.set(hostId, null);
    void this.sdk.hosts
      .directory({ hostId })
      .then((listing) => {
        this.homes.set(hostId, listing.directory);
        this.emit();
      })
      .catch(() => {});
  }

  // ── actions ─────────────────────────────────────────────────────────────

  /** True for a terminal closed or dismissed from this page. */
  removedHere(terminalId: string): boolean {
    return this.gone.has(terminalId);
  }

  /** LIST-11: the user dismissed an exited row. */
  dismiss(terminalId: string): void {
    this.gone.add(terminalId);
    this.retained.delete(terminalId);
    this.emit();
  }

  /** ACT-6. A verified close counts as dismissing the row. */
  async close(terminalId: string): Promise<void> {
    await closeTerminal(this.sdk, terminalId);
    this.forget(terminalId);
  }

  /** ACT-5. */
  async closeAll(rows: readonly HubRow[]): Promise<BulkCloseResult> {
    const result = await closeAll(this.sdk, rows);
    for (const id of result.closed) this.forget(id);
    return result;
  }

  private forget(terminalId: string): void {
    this.gone.add(terminalId);
    this.retained.delete(terminalId);
    const drop = (list: TerminalSession[]) => list.filter((t) => t.id !== terminalId);
    for (const [id, list] of this.environmentTerminals)
      this.environmentTerminals.set(id, drop(list));
    for (const [id, list] of this.threadTerminals) this.threadTerminals.set(id, drop(list));
    this.emit();
  }

  /** Puts a session the hub just created or changed straight into the list. */
  upsert(session: TerminalSession): void {
    const replace = (list: TerminalSession[]) => {
      const index = list.findIndex((t) => t.id === session.id);
      if (index === -1) return [...list, session];
      return list.map((t, i) => (i === index ? session : t));
    };
    if (session.threadId) {
      this.threadTerminals.set(
        session.threadId,
        replace(this.threadTerminals.get(session.threadId) ?? []),
      );
    } else if (session.environmentId) {
      this.environmentTerminals.set(
        session.environmentId,
        replace(this.environmentTerminals.get(session.environmentId) ?? []),
      );
    }
    this.requestHint(session.id);
    this.emit();
  }

  /** ACT-3: restart may hand back a new id; the old row goes. */
  replace(oldId: string, session: TerminalSession): void {
    if (oldId !== session.id) this.forget(oldId);
    this.upsert(session);
  }

  // ── view ────────────────────────────────────────────────────────────────

  private snapshotFor(environmentId: string): EnvironmentSnapshot {
    const threadTerminals = new Map<string, TerminalSession[]>();
    const threads = new Map<string, ThreadRecord>();
    const add = (thread: ThreadRecord, terminal: TerminalSession) => {
      threads.set(thread.id, thread);
      const list = threadTerminals.get(thread.id) ?? [];
      if (!list.some((t) => t.id === terminal.id)) list.push(terminal);
      threadTerminals.set(thread.id, list);
    };
    for (const [threadId, list] of this.threadTerminals) {
      const thread = this.threads.get(threadId);
      if (!thread) continue;
      for (const terminal of list) {
        if ((terminal.environmentId ?? thread.environmentId) === environmentId)
          add(thread, terminal);
      }
    }
    const environmentTerminals = [...(this.environmentTerminals.get(environmentId) ?? [])];
    for (const { terminal, thread } of this.retained.values()) {
      if (terminal.threadId === null) {
        if (
          terminal.environmentId === environmentId &&
          !environmentTerminals.some((t) => t.id === terminal.id)
        ) {
          environmentTerminals.push(terminal);
        }
        continue;
      }
      const owner = this.threads.get(terminal.threadId) ?? thread;
      if (owner && (terminal.environmentId ?? owner.environmentId) === environmentId) {
        add(owner, terminal);
      }
    }
    return { environmentTerminals, threads: [...threads.values()], threadTerminals };
  }

  private computeView(): HubView {
    const records =
      this.environment === ALL
        ? (this.environments ?? [])
        : (this.environments?.filter((env) => env.id === this.environment) ?? []);
    const environments = (this.environments ?? []).map(toInfo);
    const sections: Section[] = records.map((env) => {
      const grouped = groupEnvironment(this.snapshotFor(env.id));
      return {
        environment: toInfo(env),
        grouped,
        running: runningCount(grouped),
        loaded: this.environmentTerminals.has(env.id),
      };
    });
    if (this.environment !== ALL && records.length === 0 && this.environments !== null) {
      // An environment id the project does not list (destroyed, or a bad link).
      const grouped = groupEnvironment(this.snapshotFor(this.environment));
      sections.push({
        environment: { id: this.environment, name: this.environment, path: "", hostId: "" },
        grouped,
        running: runningCount(grouped),
        loaded: this.environmentTerminals.has(this.environment),
      });
    }
    const rows = sections.flatMap((section) => orderedRows(section.grouped));
    return {
      projectId: this.projectId,
      environment: this.environment,
      projects: this.projects,
      environments: this.environments === null ? null : environments,
      sections,
      rows,
      running: sections.reduce((sum, section) => sum + section.running, 0),
      hints: new Map(this.hints),
      homes: new Map(this.homes),
      error: this.error,
    };
  }
}

function toInfo(env: EnvironmentRecord): EnvironmentInfo {
  return { id: env.id, name: environmentName(env), path: env.path ?? "", hostId: env.hostId };
}

// ── the page's store, for the title bar ───────────────────────────────────

let activeStore: HubStore | null = null;
const activeListeners = new Set<Listener>();

export function setActiveHubStore(store: HubStore | null): void {
  activeStore = store;
  for (const listener of activeListeners) listener();
}

export function getActiveHubStore(): HubStore | null {
  return activeStore;
}

export function subscribeActiveHubStore(listener: Listener): () => void {
  activeListeners.add(listener);
  return () => activeListeners.delete(listener);
}
