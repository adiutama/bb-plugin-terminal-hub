// The Terminals page's data: what is listed, kept fresh on its own cadence.
//
// One store per project, kept for the app session (LIST-27): leaving the page
// stops its refreshes, and coming back shows what it last had while it checks
// again. The page and the title-bar count (NAV-6) both take the store for the
// route's project as they render, so one project's rows never show under
// another's.
import {
  type ActionsSdk,
  type BulkCloseResult,
  closeAll,
  closeTerminal,
  type VerifySdk,
} from "./actions";
import { isNotFound } from "./errors";
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
/** LIST-28: how long a return waits for the selected terminal before going on. */
export const RECONCILE_WAIT_MS = 2_000;

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

export interface HubSdk extends InventorySdk, ActionsSdk, VerifySdk {
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
  /**
   * LIST-10: this environment's terminals are all known since the page was
   * opened or returned to, so an empty section means nothing is there; or
   * its listing failed (see `error`).
   */
  loaded: boolean;
  /** Why the last listing of this environment failed, if it did. */
  error: string | null;
}

/** LIST-17: how far the first thread scan has got. */
export interface ScanProgress {
  scanned: number;
  /** Null until the project's threads are listed. */
  total: number | null;
}

/** LIST-27: whether the rows are current, or kept from before a return. */
export type Freshness = "live" | "updating" | "reconnecting";

export interface HubView {
  projectId: string;
  environment: string;
  environments: EnvironmentInfo[] | null;
  /** The environment list was fetched since the page was opened or returned to. */
  environmentsListed: boolean;
  /** One section for a single environment; every environment for All. */
  sections: Section[];
  /** Every listed row in display order, across sections. */
  rows: HubRow[];
  running: number;
  hints: ReadonlyMap<string, ServerHint>;
  homes: ReadonlyMap<string, string | null>;
  error: string | null;
  /**
   * LIST-10, LIST-17, LIST-27: the listing has succeeded since the page was
   * opened or returned to, so an empty list means nothing is there. In All:
   * the environments, a full thread scan, and every environment's own list
   * (or its error) are in.
   */
  complete: boolean;
  /** LIST-27: rows kept from before a return that are not yet confirmed. */
  lastKnown: boolean;
  freshness: Freshness;
  /** LIST-17: the first thread scan since bb loaded, while it runs; null otherwise. */
  scan: ScanProgress | null;
  /** NAV-5, LIST-28: listed terminals bb no longer has. */
  vanished: ReadonlySet<string>;
}

interface Retained {
  terminal: TerminalSession;
  thread: ThreadRecord | null;
  /** Vanished from its list; bb has not yet said whether it exited. */
  pending: boolean;
}

export function environmentName(env: EnvironmentRecord): string {
  if (env.name) return env.name;
  if (env.branchName) return env.branchName;
  return env.path?.split("/").filter(Boolean).pop() ?? env.id;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

type Listener = () => void;

export class HubStore {
  private environment: string = ALL;
  private selectedId: string | null = null;

  // ── what is known, kept across visits ──
  private environments: EnvironmentRecord[] | null = null;
  private environmentTerminals = new Map<string, TerminalSession[]>();
  private threads = new Map<string, ThreadRecord>();
  private threadTerminals = new Map<string, TerminalSession[]>();
  /** LIST-11: terminals seen running that have since exited. */
  private retained = new Map<string, Retained>();
  /** Closed or dismissed here: never retained or re-shown as exited. */
  private gone = new Set<string>();
  /** Listed once, then not found by bb: never shown again (NAV-5). */
  private vanished = new Set<string>();
  /** Exit checks in flight, so a refresh does not start a second one. */
  private checking = new Set<string>();
  private hints = new Map<string, ServerHint>();
  private hintRequested = new Set<string>();
  private tails = new Map<string, OutputTail>();
  private homes = new Map<string, string | null>();
  /** LIST-17: a full scan of this project has succeeded since bb loaded. */
  private everScanned = false;

  // ── this visit: reset when the page is left (LIST-27) ──
  /** Bumped when the page is left, so older requests never confirm anything. */
  private visit = 0;
  private attachments = 0;
  /** The page is showing this store (attached, or just detached in StrictMode). */
  private live = false;
  private awayTimer: ReturnType<typeof setTimeout> | null = null;
  /** This visit began with rows from an earlier one. */
  private returned = false;
  /** Scopes confirmed this visit; a later failure does not make them last known again. */
  private confirmed = new Set<string>();
  private environmentsListed = false;
  /** Environments whose own terminals were listed this visit, or failed to. */
  private attempted = new Set<string>();
  /** Environments whose full listing, thread terminals included, succeeded this visit. */
  private listed = new Set<string>();
  private environmentErrors = new Map<string, string>();
  /** A full thread scan of this project succeeded this visit. */
  private threadsScanned = false;
  /** The environments that scan knew of, so their threads are in. */
  private scannedEnvironments = new Set<string>();
  private scanProgress: ScanProgress | null = null;
  /** Why the environment list or the full scan last failed, this visit. */
  private environmentsError: string | null = null;
  private scanError: string | null = null;
  /** A return found the tab hidden: run its sequence once shown (LIST-28). */
  private returnPending = false;

  /** Bumped per scan, so a superseded scan's results are ignored. */
  private scanAttempt = 0;
  private scanning: { visit: number; promise: Promise<boolean> } | null = null;

  // ── ordering: a result never overwrites what a later request or action wrote ──
  private clock = 0;
  private revisions = new Map<string, number>();

  private version = 0;
  private views = new Map<string, { version: number; view: HubView }>();
  private listeners = new Set<Listener>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private signalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly sdk: HubSdk,
    readonly projectId: string,
  ) {}

  // ── subscription ────────────────────────────────────────────────────────

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** What the list shows for `environment` (an id, or `all`). Stable between changes. */
  viewFor(environment: string): HubView {
    const cached = this.views.get(environment);
    if (cached && cached.version === this.version) return cached.view;
    const view = this.computeView(environment);
    this.views.set(environment, { version: this.version, view });
    return view;
  }

  /** The view for the environment the page last selected. */
  getView = (): HubView => this.viewFor(this.environment);

  private emit(): void {
    this.version++;
    if (this.live) {
      // Once confirmed, a scope stays confirmed for the rest of the visit.
      const env = this.environment;
      if (!this.confirmed.has(env) && this.isConfirmed(env)) this.confirmed.add(env);
    }
    for (const listener of this.listeners) listener();
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /**
   * The page shows this store, for `environment` with `selectedId` selected.
   * Returns the detach function. Detaching and attaching again in the same
   * tick (React StrictMode) is not a return.
   */
  attach(environment: string, selectedId: string | null): () => void {
    this.attachments++;
    if (this.awayTimer !== null) {
      clearTimeout(this.awayTimer);
      this.awayTimer = null;
    }
    this.environment = environment;
    this.selectedId = selectedId;
    if (!this.live) this.begin();
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      this.attachments--;
      if (this.attachments === 0 && this.awayTimer === null) {
        this.awayTimer = setTimeout(() => this.leave(), 0);
      }
    };
  }

  /** What the page shows changed: the environment (or `all`), and the selection. */
  select(environment: string, selectedId: string | null): void {
    this.selectedId = selectedId;
    if (environment === this.environment) return;
    this.environment = environment;
    this.emit();
    if (this.live) {
      this.kick();
      this.arm();
    }
  }

  private begin(): void {
    this.live = true;
    const visit = this.visit;
    this.unsubscribe = this.sdk.subscribe({
      event: "thread:changed",
      callback: (event) => this.onThreadChanged(event),
    });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.emit();
    if (this.returned) void this.returnSequence(visit);
    else {
      this.kick();
      this.arm();
    }
  }

  /** LIST-27: the page was left. Keep the rows; forget what was confirmed. */
  private leave(): void {
    this.awayTimer = null;
    if (this.attachments > 0 || !this.live) return;
    this.live = false;
    this.clearTimers();
    for (const timer of this.signalTimers.values()) clearTimeout(timer);
    this.signalTimers.clear();
    this.unsubscribe?.();
    this.unsubscribe = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.visit++;
    this.returned = this.hasRows() || this.environments !== null;
    this.confirmed.clear();
    this.environmentsListed = false;
    this.attempted.clear();
    this.listed.clear();
    this.environmentErrors.clear();
    this.threadsScanned = false;
    this.scannedEnvironments.clear();
    this.scanProgress = null;
    this.environmentsError = null;
    this.scanError = null;
    this.returnPending = false;
    this.emit();
  }

  private hasRows(): boolean {
    return (
      this.environmentTerminals.size > 0 || this.threadTerminals.size > 0 || this.retained.size > 0
    );
  }

  /**
   * LIST-28: on return, the selected terminal first, then the selected
   * environment, then everything else on the usual cadence.
   */
  private async returnSequence(visit: number): Promise<void> {
    if (hidden()) {
      this.returnPending = true; // The visibility handler runs it once shown.
      return;
    }
    const still = () => visit === this.visit && this.live;
    // A check that never answers must not hold up everything else.
    await Promise.race([
      this.reconcileSelected(),
      new Promise((resolve) => setTimeout(resolve, RECONCILE_WAIT_MS)),
    ]);
    if (!still()) return;
    if (this.environment === ALL) {
      const own = this.selectedEnvironment();
      if (own !== null) await this.refreshEnvironmentScopes([own]);
      if (!still()) return;
      this.kick();
    } else {
      await this.refreshEnvironment();
      if (!still()) return;
      void this.loadEnvironments();
    }
    this.arm();
  }

  private readonly onVisibility = () => {
    if (hidden()) {
      this.clearTimers();
    } else if (this.returnPending) {
      this.returnPending = false;
      void this.returnSequence(this.visit);
    } else {
      this.kick();
      this.arm();
    }
  };

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** Refreshes what the page shows, now. */
  private kick(): void {
    if (!this.live || hidden()) return;
    if (this.environment === ALL) {
      // The first fast tick needs the environment list, which the scan loads.
      // A scan lists new environments' own terminals as soon as it finds them.
      void this.scanProject();
      if (this.environments !== null) void this.refreshEnvironmentScopes();
    } else {
      void this.loadEnvironments();
      void this.refreshEnvironment();
    }
  }

  /** Arms the refresh cadence (LIST-8, LIST-14). */
  private arm(): void {
    this.clearTimers();
    if (!this.live || hidden()) return;
    const fast = () => {
      if (this.environment !== ALL && !this.environmentsListed) void this.loadEnvironments();
      void (this.environment === ALL ? this.refreshEnvironmentScopes() : this.refreshEnvironment());
      this.timers[0] = setTimeout(fast, FAST_REFRESH_MS);
    };
    this.timers[0] = setTimeout(fast, FAST_REFRESH_MS);
    if (this.environment === ALL) {
      const scan = () => {
        void this.scanProject();
        this.timers[1] = setTimeout(scan, SCAN_REFRESH_MS);
      };
      this.timers[1] = setTimeout(scan, SCAN_REFRESH_MS);
    }
  }

  // ── ordering ────────────────────────────────────────────────────────────

  /** A sequence number for a request about to go out, or a change made here. */
  private tick(): number {
    return ++this.clock;
  }

  /**
   * Whether data from request `seq` may replace scope `key`: only if nothing
   * from a later request or action was written there.
   */
  private accept(key: string, seq: number): boolean {
    if ((this.revisions.get(key) ?? 0) > seq) return false;
    this.revisions.set(key, seq);
    return true;
  }

  // ── loading ─────────────────────────────────────────────────────────────

  /** True when the project's environments were listed. */
  private async loadEnvironments(): Promise<boolean> {
    const visit = this.visit;
    const seq = this.tick();
    try {
      const environments = await this.sdk.environments.list({ projectId: this.projectId });
      if (this.accept("environments", seq)) {
        this.environments = environments.filter((env) => env.status !== "destroyed");
        for (const env of this.environments) this.requestHome(env.hostId);
      }
      if (visit === this.visit) {
        this.environmentsListed = true;
        this.environmentsError = null;
      }
      this.emit();
      return true;
    } catch (error) {
      if (visit === this.visit) this.environmentsError = message(error);
      this.emit();
      return false;
    }
  }

  /** LIST-8: one environment, all of it. True when it was listed. */
  async refreshEnvironment(environmentId: string = this.environment): Promise<boolean> {
    if (environmentId === ALL) return false;
    const visit = this.visit;
    const seq = this.tick();
    let ok = false;
    try {
      const snapshot = await loadEnvironment(this.sdk, environmentId);
      this.mergeEnvironment(environmentId, snapshot, seq);
      if (visit === this.visit) {
        this.environmentErrors.delete(environmentId);
        this.listed.add(environmentId);
      }
      ok = true;
    } catch (error) {
      if (visit === this.visit) this.environmentErrors.set(environmentId, message(error));
    }
    if (visit === this.visit) this.attempted.add(environmentId);
    this.recheckPending();
    this.emit();
    return ok;
  }

  /** LIST-14: environments' own terminals, all or `only` these. True when all were listed. */
  async refreshEnvironmentScopes(only?: readonly string[]): Promise<boolean> {
    const visit = this.visit;
    const environments = (this.environments ?? []).filter(
      (env) => only === undefined || only.includes(env.id),
    );
    const seq = this.tick();
    const lists = await mapLimited(environments, SCAN_CONCURRENCY, async (env) => {
      try {
        return await listEnvironmentTerminals(this.sdk, env.id);
      } catch (error) {
        return message(error);
      }
    });
    let ok = true;
    environments.forEach((env, index) => {
      const list = lists[index];
      if (typeof list === "string") {
        ok = false;
        if (visit === this.visit) this.environmentErrors.set(env.id, list);
      } else if (list) {
        this.replaceEnvironmentTerminals(env.id, list, seq);
        if (visit === this.visit) this.environmentErrors.delete(env.id);
      }
      if (visit === this.visit) this.attempted.add(env.id);
    });
    this.recheckPending();
    this.emit();
    return ok;
  }

  /**
   * LIST-14: the full scan of every thread in the project; one at a time per
   * visit. `fresh` starts a new one even if one is running. True on success.
   */
  scanProject(fresh = false): Promise<boolean> {
    if (!fresh && this.scanning?.visit === this.visit) return this.scanning.promise;
    const visit = this.visit;
    const promise = this.runScan(visit, ++this.scanAttempt).finally(() => {
      if (this.scanning?.promise === promise) this.scanning = null;
    });
    this.scanning = { visit, promise };
    return promise;
  }

  private async runScan(visit: number, attempt: number): Promise<boolean> {
    const current = () => attempt === this.scanAttempt;
    // LIST-17: progress is shown until the first scan since bb loaded succeeds.
    const progress = (next: ScanProgress | null) => {
      if (!current() || visit !== this.visit || this.everScanned) return;
      this.scanProgress = next;
      this.emit();
    };
    progress({ scanned: 0, total: null });
    try {
      if (!(await this.loadEnvironments())) {
        progress(null);
        return false;
      }
      const known = new Set((this.environments ?? []).map((env) => env.id));
      if (
        current() &&
        visit === this.visit &&
        this.environments?.some((env) => !this.attempted.has(env.id))
      ) {
        void this.refreshEnvironmentScopes();
      }
      const recordSeq = this.tick();
      const threads = await listAllThreads(this.sdk, { projectId: this.projectId });
      progress({ scanned: 0, total: threads.length });
      const seqs = new Map<string, number>();
      const terminals = await scanThreadTerminals(
        this.sdk,
        threads,
        (scanned) => progress({ scanned, total: threads.length }),
        (threadId) => seqs.set(threadId, this.tick()),
      );
      if (!current()) return false;
      const previous = new Map(this.threads);
      const incoming = new Map(threads.map((thread) => [thread.id, thread]));
      for (const [id, record] of incoming) {
        if (this.accept(`record:${id}`, recordSeq)) this.threads.set(id, record);
      }
      for (const id of [...this.threads.keys()]) {
        if (!incoming.has(id) && this.accept(`record:${id}`, recordSeq)) this.threads.delete(id);
      }
      for (const id of [...this.threadTerminals.keys()]) {
        // A deleted thread's terminals exit with it; keep its record for their rows.
        if (!terminals.has(id)) {
          this.replaceThreadTerminals(id, [], recordSeq, previous.get(id) ?? null);
        }
      }
      for (const [id, list] of terminals) {
        this.replaceThreadTerminals(id, list, seqs.get(id) ?? recordSeq);
      }
      this.recheckPending();
      this.everScanned = true;
      this.scanProgress = null;
      if (visit === this.visit) {
        this.threadsScanned = true;
        this.scannedEnvironments = known;
        this.scanError = null;
      }
      this.emit();
      return true;
    } catch (error) {
      if (!current()) return false;
      if (visit === this.visit) this.scanError = message(error);
      this.scanProgress = null;
      this.emit();
      return false;
    }
  }

  /** LIST-14: one thread, at once, when bb says its terminals changed. */
  async refreshThread(threadId: string): Promise<void> {
    const seq = this.tick();
    try {
      const [thread, list] = await Promise.all([
        this.sdk.threads.get({ threadId }),
        listThreadTerminals(this.sdk, threadId),
      ]);
      if (this.accept(`record:${thread.id}`, seq)) this.threads.set(thread.id, thread);
      this.replaceThreadTerminals(threadId, list, seq);
      this.emit();
    } catch {
      // A deleted thread or a hiccup: the next scan settles it.
    }
  }

  /**
   * ACT-5: refreshes what `environment` shows, now. True only if every part
   * of this refresh succeeded.
   */
  async refresh(environment: string): Promise<boolean> {
    if (environment !== ALL) return this.refreshEnvironment(environment);
    const [scanned, own] = await Promise.all([
      this.scanProject(true),
      this.refreshEnvironmentScopes(),
    ]);
    return scanned && own;
  }

  private onThreadChanged(event: ThreadChangedEvent): void {
    const id = event.id;
    if (id === undefined) return;
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
        if (this.live) run();
      }, SIGNAL_DEBOUNCE_MS),
    );
  }

  // ── the selected terminal ───────────────────────────────────────────────

  /** The environment of the selected terminal, when the list holds it. */
  private selectedEnvironment(): string | null {
    const found = this.selectedId === null ? null : this.find(this.selectedId);
    if (!found) return null;
    return found.terminal.environmentId ?? found.thread?.environmentId ?? null;
  }

  /** LIST-28: running, exited, gone, or unreachable. Only a listed selection. */
  private async reconcileSelected(): Promise<void> {
    const id = this.selectedId;
    if (id === null || !this.find(id)) return;
    const seq = this.tick();
    try {
      const session = await this.sdk.terminals.get({ terminalId: id });
      if (this.gone.has(id) || this.vanished.has(id)) return;
      this.put(session, seq);
    } catch (error) {
      // Not reachable: the row and view stay, and the view shows the problem.
      if (isNotFound(error)) this.vanish(id);
    }
    this.emit();
  }

  /**
   * VIEW-7: the view saw its terminal end. An exit shows on the row at once;
   * a closed session is checked with bb like any vanished row.
   */
  noteEnded(terminalId: string, status: "exited" | "gone", exitCode: number | null): void {
    const found = this.find(terminalId);
    if (!found || this.gone.has(terminalId)) return;
    if (status === "exited") {
      if (!isRunning(found.terminal) && !found.pending) return;
      this.settle({ ...found.terminal, status: "exited", exitCode }, this.tick());
    } else {
      if (found.pending || !isRunning(found.terminal)) return;
      this.drop(terminalId, this.tick());
      this.retained.set(terminalId, {
        terminal: found.terminal,
        thread: found.thread,
        pending: true,
      });
      void this.checkExited(found.terminal, found.thread);
    }
    this.emit();
  }

  /** A listed or retained terminal, with its owner record. */
  private find(
    terminalId: string,
  ): { terminal: TerminalSession; thread: ThreadRecord | null; pending: boolean } | null {
    for (const list of this.environmentTerminals.values()) {
      const terminal = list.find((t) => t.id === terminalId);
      if (terminal) return { terminal, thread: null, pending: false };
    }
    for (const [threadId, list] of this.threadTerminals) {
      const terminal = list.find((t) => t.id === terminalId);
      if (terminal) return { terminal, thread: this.threads.get(threadId) ?? null, pending: false };
    }
    const retained = this.retained.get(terminalId);
    if (retained) {
      const owner = retained.terminal.threadId
        ? (this.threads.get(retained.terminal.threadId) ?? retained.thread)
        : null;
      return { terminal: retained.terminal, thread: owner, pending: retained.pending };
    }
    return null;
  }

  /** Whether something later than `seq` already wrote `key`. */
  private outdated(key: string, seq: number): boolean {
    return (this.revisions.get(key) ?? 0) > seq;
  }

  /** LIST-11: an exited session takes its row's place as a kept exited row. */
  private settle(session: TerminalSession, seq: number): void {
    const found = this.find(session.id);
    if (!found || !this.accept(`terminal:${session.id}`, seq)) return;
    this.drop(session.id, seq);
    this.retained.set(session.id, { terminal: session, thread: found.thread, pending: false });
  }

  /** NAV-5: bb no longer has this terminal. */
  private vanish(terminalId: string): void {
    const seq = this.tick();
    this.vanished.add(terminalId);
    this.retained.delete(terminalId);
    this.accept(`terminal:${terminalId}`, seq);
    this.drop(terminalId, seq);
  }

  /** Takes a terminal out of whichever list holds it, as change `seq`. */
  private drop(terminalId: string, seq: number): void {
    for (const [id, list] of this.environmentTerminals) {
      if (list.some((t) => t.id === terminalId) && this.accept(`env:${id}`, seq)) {
        this.environmentTerminals.set(
          id,
          list.filter((t) => t.id !== terminalId),
        );
      }
    }
    for (const [id, list] of this.threadTerminals) {
      if (list.some((t) => t.id === terminalId) && this.accept(`thread:${id}`, seq)) {
        const next = list.filter((t) => t.id !== terminalId);
        if (next.length === 0) this.threadTerminals.delete(id);
        else this.threadTerminals.set(id, next);
      }
    }
  }

  // ── merging ─────────────────────────────────────────────────────────────

  private mergeEnvironment(
    environmentId: string,
    snapshot: EnvironmentSnapshot,
    seq: number,
  ): void {
    this.replaceEnvironmentTerminals(environmentId, snapshot.environmentTerminals, seq);
    for (const [id, thread] of [...this.threads]) {
      if (
        thread.environmentId === environmentId &&
        !snapshot.threadTerminals.has(id) &&
        this.accept(`record:${id}`, seq)
      ) {
        this.threads.delete(id);
        this.replaceThreadTerminals(id, [], seq, thread);
      }
    }
    for (const thread of snapshot.threads) {
      if (this.accept(`record:${thread.id}`, seq)) this.threads.set(thread.id, thread);
    }
    for (const [id, list] of snapshot.threadTerminals) this.replaceThreadTerminals(id, list, seq);
  }

  /** Closed, dismissed, or not found: never shown from a list again. */
  private withoutGone(list: TerminalSession[]): TerminalSession[] {
    return list.filter(
      (terminal) => !this.gone.has(terminal.id) && !this.vanished.has(terminal.id),
    );
  }

  private replaceEnvironmentTerminals(
    environmentId: string,
    incoming: TerminalSession[],
    seq: number,
  ): void {
    if (!this.accept(`env:${environmentId}`, seq)) return;
    const list = this.withoutGone(incoming);
    const previous = this.environmentTerminals.get(environmentId) ?? [];
    this.environmentTerminals.set(environmentId, list);
    this.noticeChanges(previous, list, null);
  }

  private replaceThreadTerminals(
    threadId: string,
    incoming: TerminalSession[],
    seq: number,
    owner: ThreadRecord | null = this.threads.get(threadId) ?? null,
  ): void {
    if (!this.accept(`thread:${threadId}`, seq)) return;
    const list = this.withoutGone(incoming);
    const previous = this.threadTerminals.get(threadId) ?? [];
    if (list.length === 0) this.threadTerminals.delete(threadId);
    else this.threadTerminals.set(threadId, list);
    this.noticeChanges(previous, list, owner);
  }

  /** New terminals get a one-time hint read; vanished running ones are checked. */
  private noticeChanges(
    previous: readonly TerminalSession[],
    next: readonly TerminalSession[],
    thread: ThreadRecord | null,
  ): void {
    const ids = new Set(next.map((terminal) => terminal.id));
    for (const terminal of next) {
      this.retained.delete(terminal.id);
      this.requestHome(terminal.hostId);
      if (isRunning(terminal)) this.requestHint(terminal.id);
    }
    for (const terminal of previous) {
      if (!ids.has(terminal.id) && isRunning(terminal) && !this.gone.has(terminal.id)) {
        // Keep the row in place while bb is asked why it went, so a selected
        // terminal that exits never blinks out of the list (LIST-11, VIEW-7).
        this.retained.set(terminal.id, { terminal, thread, pending: true });
        void this.checkExited(terminal, thread);
      }
    }
  }

  /** LIST-11: a listed terminal vanished; keep it if it exited. */
  private async checkExited(terminal: TerminalSession, thread: ThreadRecord | null): Promise<void> {
    if (this.checking.has(terminal.id)) return;
    this.checking.add(terminal.id);
    try {
      const session = await this.sdk.terminals.get({ terminalId: terminal.id });
      if (this.gone.has(terminal.id)) return;
      if (!this.retained.get(terminal.id)?.pending) return;
      if (session.status === "exited") {
        this.retained.set(terminal.id, { terminal: session, thread, pending: false });
      } else {
        // Still alive, just not in that list any more: the next listing has it.
        this.retained.delete(terminal.id);
      }
    } catch (error) {
      // Gone without a trace: nothing to show (NAV-5). Any other failure
      // keeps the row waiting; the next refresh asks again.
      if (isNotFound(error)) this.vanish(terminal.id);
    } finally {
      this.checking.delete(terminal.id);
    }
    this.emit();
  }

  /** Asks again about rows whose exit check failed. */
  private recheckPending(): void {
    for (const { terminal, thread, pending } of this.retained.values()) {
      if (pending) void this.checkExited(terminal, thread);
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

  /** ACT-5: closes the rows that are still stale when checked again. */
  async closeAll(rows: readonly HubRow[]): Promise<BulkCloseResult> {
    const result = await closeAll(this.sdk, rows);
    for (const id of result.closed) this.forget(id);
    return result;
  }

  private forget(terminalId: string): void {
    this.gone.add(terminalId);
    this.retained.delete(terminalId);
    this.drop(terminalId, this.tick());
    this.emit();
  }

  /** Puts a session the hub just created or changed straight into the list. */
  upsert(session: TerminalSession): void {
    if (this.gone.has(session.id) || this.vanished.has(session.id)) return;
    this.put(session, this.tick());
    this.requestHint(session.id);
    this.emit();
  }

  /**
   * A session bb just returned, as change `seq`: a running one goes into its
   * list; an ended one becomes a kept exited row (LIST-11), never a list entry.
   * Nothing happens if a later change already wrote its list or its row.
   */
  private put(session: TerminalSession, seq: number): void {
    if (!isRunning(session)) {
      this.settle(session, seq);
      return;
    }
    const listKey = session.threadId
      ? `thread:${session.threadId}`
      : session.environmentId
        ? `env:${session.environmentId}`
        : null;
    const rowKey = `terminal:${session.id}`;
    if (listKey === null || this.outdated(listKey, seq) || this.outdated(rowKey, seq)) return;
    this.accept(listKey, seq);
    this.accept(rowKey, seq);
    this.retained.delete(session.id);
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

  /**
   * LIST-10: an environment's terminals are all known this visit when its
   * full listing succeeded, or when its own list did after a full project scan.
   */
  private covered(environmentId: string): boolean {
    if (this.listed.has(environmentId)) return true;
    return (
      this.scannedEnvironments.has(environmentId) &&
      this.attempted.has(environmentId) &&
      !this.environmentErrors.has(environmentId)
    );
  }

  /** LIST-10, LIST-17: complete this visit, failures allowed in All. */
  private isComplete(environment: string): boolean {
    if (environment !== ALL) return this.covered(environment);
    return (
      this.environmentsListed &&
      this.environments !== null &&
      this.threadsScanned &&
      this.environments.every((env) => this.attempted.has(env.id))
    );
  }

  /** LIST-27: complete this visit with nothing failed. */
  private isConfirmed(environment: string): boolean {
    if (!this.isComplete(environment)) return false;
    if (environment !== ALL) return !this.environmentErrors.has(environment);
    return this.currentError() === null && this.environmentErrors.size === 0;
  }

  private currentError(): string | null {
    return this.scanError ?? this.environmentsError;
  }

  private computeView(environment: string): HubView {
    const lastKnown =
      this.returned && !this.confirmed.has(environment) && !this.isConfirmed(environment);
    const records =
      environment === ALL
        ? (this.environments ?? [])
        : (this.environments?.filter((env) => env.id === environment) ?? []);
    const environments = (this.environments ?? []).map(toInfo);
    const section = (env: EnvironmentInfo): Section => {
      const grouped = groupEnvironment(this.snapshotFor(env.id));
      const error = this.environmentErrors.get(env.id) ?? null;
      return {
        environment: env,
        grouped,
        running: runningCount(grouped),
        loaded: (this.covered(env.id) && !lastKnown) || error !== null,
        error,
      };
    };
    const sections = records.map((env) => section(toInfo(env)));
    if (environment !== ALL && records.length === 0 && this.environments !== null) {
      // An environment id the project does not list (destroyed, or a bad link).
      sections.push(section({ id: environment, name: environment, path: "", hostId: "" }));
    }
    const rows = sections.flatMap((s) => orderedRows(s.grouped));
    const failed =
      environment === ALL
        ? this.currentError() !== null || this.environmentErrors.size > 0
        : this.currentError() !== null || this.environmentErrors.has(environment);
    return {
      projectId: this.projectId,
      environment,
      environments: this.environments === null ? null : environments,
      environmentsListed: this.environmentsListed,
      sections,
      rows,
      running: sections.reduce((sum, s) => sum + s.running, 0),
      hints: new Map(this.hints),
      homes: new Map(this.homes),
      error: this.currentError(),
      complete: this.isComplete(environment) && !lastKnown,
      lastKnown,
      freshness: !lastKnown ? "live" : failed ? "reconnecting" : "updating",
      scan: environment === ALL && !this.everScanned ? this.scanProgress : null,
      vanished: new Set(this.vanished),
    };
  }
}

function toInfo(env: EnvironmentRecord): EnvironmentInfo {
  return { id: env.id, name: environmentName(env), path: env.path ?? "", hostId: env.hostId };
}

// ── one store per project, for the app session ────────────────────────────

const stores = new WeakMap<object, Map<string, HubStore>>();

/** The project's store; `useSdk()` is stable for the plugin's lifetime. */
export function hubStoreFor(sdk: HubSdk, projectId: string): HubStore {
  let byProject = stores.get(sdk);
  if (!byProject) {
    byProject = new Map();
    stores.set(sdk, byProject);
  }
  let store = byProject.get(projectId);
  if (!store) {
    store = new HubStore(sdk, projectId);
    byProject.set(projectId, store);
  }
  return store;
}

// ── the project picker's list ──────────────────────────────────────────────

/** BB's projects, for the picker and NAV-4; loaded again on each visit. */
export class ProjectList {
  private projects: ProjectRecord[] | null = null;
  private error: string | null = null;
  private listeners = new Set<Listener>();
  private snapshot: { projects: ProjectRecord[] | null; error: string | null } = {
    projects: null,
    error: null,
  };

  constructor(private readonly sdk: Pick<HubSdk, "projects">) {}

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get = () => this.snapshot;

  async load(): Promise<void> {
    try {
      this.projects = await this.sdk.projects.list();
      this.error = null;
    } catch (error) {
      this.error = message(error);
    }
    this.snapshot = { projects: this.projects, error: this.error };
    for (const listener of this.listeners) listener();
  }
}

const projectLists = new WeakMap<object, ProjectList>();

export function projectsFor(sdk: HubSdk): ProjectList {
  let list = projectLists.get(sdk);
  if (!list) {
    list = new ProjectList(sdk);
    projectLists.set(sdk, list);
  }
  return list;
}
