// One project's terminals, kept fresh on their own cadence.
//
// One store per project, kept for the app session (LIST-27): leaving the page
// stops its refreshes, and coming back shows what it last had while it checks
// again. While the page is shown every project's store runs (LIST-8); the one
// holding the selected environment polls it more often. `lib/hub.ts` puts the
// stores together for the rail and the title bar.
import { type ActionsSdk, closeTerminal } from "./actions";
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
  runningCount,
  SCAN_CONCURRENCY,
  scanThreadTerminals,
  type TerminalSession,
  type ThreadRecord,
  tabOrder,
} from "./inventory";
import { findServerHint, HINT_TAIL_BYTES, OutputTail, type ServerHint } from "./server-hint";
import { base64ToBytes } from "./terminal-io";
import type { TransportSdk } from "./terminal-transport";

/** LIST-8: the selected environment's own terminals. */
export const FAST_REFRESH_MS = 5_000;
/** LIST-8: every other listed environment's own terminals. */
export const SLOW_REFRESH_MS = 30_000;
/** LIST-8: the fallback full listing, in case a signal was missed. */
export const SCAN_REFRESH_MS = 120_000;
/** Coalesces bursts of thread change signals into one refresh. */
export const SIGNAL_DEBOUNCE_MS = 250;
/** LIST-28: how long a return waits for the selected terminal before going on. */
export const RECONCILE_WAIT_MS = 2_000;
/** LIST-28: how long other projects wait for the selected environment on a return. */
export const GATE_WAIT_MS = 4_000;
/** Typing into a thread terminal signals every key; refresh at least this often. */
export const SIGNAL_MAX_WAIT_MS = 1_000;

/** LIST-30: thread changes that alter its title, state, or environment. */
const RECORD_CHANGES = [
  "thread-created",
  "archived-changed",
  "status-changed",
  "title-changed",
  "environment-changed",
];

export interface EnvironmentRecord {
  id: string;
  name: string | null;
  branchName?: string | null;
  path: string | null;
  hostId: string;
  status: string;
}

/**
 * LIST-28: on a return, the selected environment is listed before any other
 * project's full listing. The store holding it opens the gate; the others
 * wait for it, but never longer than GATE_WAIT_MS.
 */
export interface Gate {
  wait(): Promise<void>;
  open(): void;
}

export function createGate(): Gate {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait: () => promise, open: () => open() };
}

export const OPEN_GATE: Gate = { wait: () => Promise.resolve(), open: () => {} };

export interface ThreadChangedEvent {
  id?: string;
  changes: readonly string[];
  metadata?: {
    projectId?: string;
    statusChange?: { status: string; latestAttentionAt: number };
  };
}

export interface EnvironmentChangedEvent {
  id?: string;
  changes: readonly string[];
}

/** bb's realtime connection, which delivers the signals above. */
export interface ConnectionEvent {
  state: "connected" | "connecting" | "disconnected";
  reconnected: boolean;
}

type Subscription =
  | { event: "thread:changed"; callback: (event: ThreadChangedEvent) => void }
  | { event: "environment:changed"; callback: (event: EnvironmentChangedEvent) => void }
  | { event: "realtime:connection"; callback: (event: ConnectionEvent) => void };

/** LIST-30: a request in flight; `next` settles with its re-run, if one was asked for. */
interface Flight {
  promise: Promise<boolean>;
  visit: number;
  next: { promise: Promise<boolean>; settle: (result: Promise<boolean> | boolean) => void } | null;
}

/** LIST-30: what a thread's signals asked for since it was last fetched. */
interface ThreadNeeds {
  record: boolean;
  terminals: boolean;
  deleted: boolean;
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
  projects: { list(): Promise<{ id: string; name: string }[]> };
  hosts: { directory(args: { hostId: string }): Promise<{ directory: string }> };
  subscribe(args: Subscription): () => void;
}

export interface EnvironmentInfo {
  id: string;
  /** LIST-34: the name as the page shows it, told apart from same-named ones. */
  name: string;
  path: string;
  hostId: string;
}

export interface Section {
  environment: EnvironmentInfo;
  grouped: GroupedEnvironment;
  /** LIST-12: the environment's tabs, in order. */
  rows: HubRow[];
  /** LIST-34: its running terminals. */
  running: number;
  /** Why the last listing of this environment failed, if it did. */
  error: string | null;
}

export interface HubView {
  projectId: string;
  /** Every environment of the project, in bb's order; null until listed. */
  environments: EnvironmentInfo[] | null;
  /** One section per environment, in bb's order, empty ones included. */
  sections: Section[];
  /** Every listed row, section by section. */
  rows: HubRow[];
  running: number;
  hints: ReadonlyMap<string, ServerHint>;
  homes: ReadonlyMap<string, string | null>;
  /** Why the project's environments or its full listing last failed. */
  error: string | null;
  /** The project's listing or one of its environments' failed this visit. */
  failed: boolean;
  /**
   * LIST-17: the environments, a full thread scan, and every environment's
   * own list (or its error) are in since the page was opened or returned to.
   */
  complete: boolean;
  /** LIST-17, LIST-25: complete, with nothing failed. */
  succeeded: boolean;
  /**
   * NAV-4: the project was listed in full at least once since bb loaded, or
   * its listing failed: what it lists is all it has for now.
   */
  ready: boolean;
  /** LIST-27: rows kept from before a return that are not yet confirmed. */
  lastKnown: boolean;
  /** LIST-27: bb's realtime connection is down. */
  reconnecting: boolean;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

type Listener = () => void;

export class HubStore {
  /** The selected environment, when this project holds it. */
  private environment: string | null = null;
  private selectedId: string | null = null;
  private gate: Gate = OPEN_GATE;

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
  /** NAV-4: the project was complete at least once since bb loaded. */
  private everListed = false;

  // ── this visit: reset when the page is left (LIST-27) ──
  /** Bumped when the page is left, so older requests never confirm anything. */
  private visit = 0;
  private attachments = 0;
  /** The page is showing this store (attached, or just detached in StrictMode). */
  private live = false;
  private awayTimer: ReturnType<typeof setTimeout> | null = null;
  /** This visit began with rows from an earlier one. */
  private returned = false;
  /** Confirmed this visit; a later failure does not make it last known again. */
  private confirmed = false;
  private environmentsListed = false;
  /** Environments whose own terminals were listed this visit, or failed to. */
  private attempted = new Set<string>();
  private environmentErrors = new Map<string, string>();
  /** A full thread scan of this project succeeded this visit. */
  private threadsScanned = false;
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
  private cached: { version: number; view: HubView } | null = null;
  private listeners = new Set<Listener>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private signalTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; first: number }>();
  private subscribed = false;
  /** LIST-30, LIST-31: threads to fetch, marked by signals; kept while away. */
  private dirtyThreads = new Map<string, ThreadNeeds>();
  /** LIST-30: one request per scope; `again` runs it once more when it ends. */
  private flights = new Map<string, Flight>();
  /** Threads whose record is being fetched now (LIST-30). */
  private fetchingRecords = new Map<string, number>();
  /** LIST-27: bb's realtime connection, as its own signal and the page's hook see it. */
  private socketUp = true;
  private hookUp = true;
  /** When the last full listing started, for the 2-minute fallback. */
  private lastFull = 0;

  constructor(
    private readonly sdk: HubSdk,
    readonly projectId: string,
  ) {}

  // ── subscription ────────────────────────────────────────────────────────

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** What the project lists. Stable between changes. */
  getView = (): HubView => {
    if (this.cached && this.cached.version === this.version) return this.cached.view;
    const view = this.computeView();
    this.cached = { version: this.version, view };
    return view;
  };

  private emit(): void {
    this.version++;
    // Once confirmed, the project stays confirmed for the rest of the visit.
    if (this.live && !this.confirmed && this.isConfirmed()) this.confirmed = true;
    if (this.isComplete()) this.everListed = true;
    for (const listener of this.listeners) listener();
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /**
   * The page shows this store; `environment` and `selectedId` are the
   * selection when this project holds it, else null. Returns the detach
   * function. Detaching and attaching again in the same tick (React
   * StrictMode) is not a return.
   */
  attach(
    environment: string | null,
    selectedId: string | null,
    gate: Gate = OPEN_GATE,
  ): () => void {
    this.attachments++;
    if (this.awayTimer !== null) {
      clearTimeout(this.awayTimer);
      this.awayTimer = null;
    }
    this.environment = environment;
    this.selectedId = selectedId;
    this.gate = gate;
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

  /** The selection changed: the environment and terminal, when this project holds them. */
  select(environment: string | null, selectedId: string | null): void {
    this.selectedId = selectedId;
    if (environment === this.environment) return;
    this.environment = environment;
    this.emit();
    // LIST-8: a newly selected environment is listed now, then every 5 s.
    if (this.live && environment !== null && !hidden()) {
      void this.refreshEnvironmentScopes([environment]);
      this.arm();
    }
  }

  private begin(): void {
    this.live = true;
    const visit = this.visit;
    this.subscribeOnce();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.emit();
    if (this.returned) void this.returnSequence(visit);
    else {
      if (this.environment !== null) this.gate.open();
      this.full();
      this.arm();
    }
  }

  /** LIST-31: subscribed from the first visit until bb reloads, away included. */
  private subscribeOnce(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    this.sdk.subscribe({
      event: "thread:changed",
      callback: (event) => this.onThreadChanged(event),
    });
    this.sdk.subscribe({
      event: "environment:changed",
      callback: (event) => this.onEnvironmentChanged(event),
    });
    this.sdk.subscribe({
      event: "realtime:connection",
      callback: (event) => this.onConnection(event),
    });
  }

  /** LIST-27: the page was left. Keep the rows; forget what was confirmed. */
  private leave(): void {
    this.awayTimer = null;
    if (this.attachments > 0 || !this.live) return;
    this.live = false;
    this.clearTimers();
    for (const { timer } of this.signalTimers.values()) clearTimeout(timer);
    this.signalTimers.clear();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.unconfirm();
  }

  /** LIST-27: rows stay, but nothing counts as confirmed any more. */
  private unconfirm(): void {
    this.visit++;
    this.returned = this.hasRows() || this.environments !== null;
    this.confirmed = false;
    this.environmentsListed = false;
    this.attempted.clear();
    this.environmentErrors.clear();
    this.threadsScanned = false;
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
   * LIST-28: on return (or reconnect), the selected terminal first, then the
   * selected environment, then the threads that changed meanwhile, then the
   * full listing; then the usual cadence. A project without the selection
   * waits for the one with it (the gate) before its own listing.
   */
  private async returnSequence(visit: number): Promise<void> {
    if (hidden()) {
      this.returnPending = true; // The visibility handler runs it once shown.
      return;
    }
    const still = () => visit === this.visit && this.live;
    const selected = this.environment;
    if (selected !== null) {
      // A check that never answers must not hold up everything else.
      await Promise.race([this.reconcileSelected(), delay(RECONCILE_WAIT_MS)]);
      if (!still()) return;
      await this.refreshEnvironment(selected);
      this.gate.open();
    } else {
      await Promise.race([this.gate.wait(), delay(GATE_WAIT_MS)]);
    }
    if (!still()) return;
    await mapLimited([...this.dirtyThreads.keys()], SCAN_CONCURRENCY, (id) =>
      this.fetchThreadOnce(id),
    );
    if (!still()) return;
    this.full();
    this.arm();
  }

  private readonly onVisibility = () => {
    if (hidden()) {
      this.clearTimers();
    } else if (this.returnPending) {
      this.returnPending = false;
      void this.returnSequence(this.visit);
    } else {
      this.fast();
      this.arm();
    }
  };

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /**
   * LIST-8: the project in full, now: its environments, every thread and
   * its terminals, and every environment's own terminals.
   */
  private full(): void {
    if (!this.live || hidden()) return;
    this.lastFull = Date.now();
    // A scan lists new environments' own terminals as soon as it finds them.
    void this.scanProject();
    if (this.environments !== null) void this.refreshEnvironmentScopes();
  }

  /**
   * LIST-8: the selected environment's own terminals, which send no signal.
   * Until the project is complete (a failed listing, say), the full listing
   * is tried instead (LIST-17).
   */
  private fast(): void {
    if (!this.live || hidden()) return;
    if (!this.isComplete()) this.full();
    else if (this.environment !== null) void this.refreshEnvironmentScopes([this.environment]);
  }

  /** LIST-8: every other environment the rail lists, its own terminals. */
  private slow(): void {
    if (!this.live || hidden() || !this.isComplete()) return;
    const others = this.getView()
      .sections.filter((s) => s.rows.length > 0 && s.environment.id !== this.environment)
      .map((s) => s.environment.id);
    if (others.length > 0) void this.refreshEnvironmentScopes(others);
  }

  /**
   * Arms the cadence: the selected environment every 5 s, the other listed
   * ones every 30 s, the full listing every 2 min.
   */
  private arm(): void {
    this.clearTimers();
    if (!this.live || hidden()) return;
    const fast = () => {
      this.fast();
      this.timers[0] = setTimeout(fast, FAST_REFRESH_MS);
    };
    this.timers[0] = setTimeout(fast, FAST_REFRESH_MS);
    const slow = () => {
      this.slow();
      this.timers[1] = setTimeout(slow, SLOW_REFRESH_MS);
    };
    this.timers[1] = setTimeout(slow, SLOW_REFRESH_MS);
    const full = () => {
      this.full();
      this.timers[2] = setTimeout(full, SCAN_REFRESH_MS);
    };
    this.timers[2] = setTimeout(full, Math.max(0, this.lastFull + SCAN_REFRESH_MS - Date.now()));
  }

  /**
   * LIST-30: runs `run` unless a request for `key` is in flight. With
   * `again`, a request already in flight runs once more when it ends, and the
   * caller gets that re-run's result.
   */
  private single(key: string, run: () => Promise<boolean>, again = false): Promise<boolean> {
    const flight = this.flights.get(key);
    // A request from before a return or reconnect cannot confirm this visit,
    // and may never answer: start a new one beside it.
    if (flight && flight.visit === this.visit) {
      if (!again) return flight.promise;
      if (!flight.next) {
        let settle: (result: Promise<boolean> | boolean) => void = () => {};
        const promise = new Promise<boolean>((resolve) => {
          settle = resolve;
        });
        flight.next = { promise, settle };
      }
      return flight.next.promise;
    }
    const entry: Flight = { promise: Promise.resolve(false), visit: this.visit, next: null };
    entry.promise = run().finally(() => {
      const next = entry.next;
      if (this.flights.get(key) === entry) this.flights.delete(key);
      if (!next) return;
      // Superseded, or the page was left: nobody needs the re-run any more.
      if (entry.visit !== this.visit || !this.live) next.settle(false);
      else next.settle(this.single(key, run));
    });
    this.flights.set(key, entry);
    return entry.promise;
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

  /** True when the project's environments were listed; one request at a time. */
  private loadEnvironments(again = false): Promise<boolean> {
    return this.single("environments", () => this.listEnvironments(), again);
  }

  private async listEnvironments(): Promise<boolean> {
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

  /**
   * LIST-28: one environment, all of it (its own terminals, its
   * threads and theirs); one request at a time. True when it was listed.
   */
  refreshEnvironment(environmentId: string): Promise<boolean> {
    return this.single(`env:${environmentId}`, () => this.listEnvironment(environmentId));
  }

  private async listEnvironment(environmentId: string): Promise<boolean> {
    const visit = this.visit;
    const seq = this.tick();
    let ok = false;
    try {
      const snapshot = await loadEnvironment(this.sdk, environmentId);
      this.mergeEnvironment(environmentId, snapshot, seq);
      if (visit === this.visit) this.environmentErrors.delete(environmentId);
      ok = true;
    } catch (error) {
      if (visit === this.visit) this.environmentErrors.set(environmentId, message(error));
    }
    if (visit === this.visit) this.attempted.add(environmentId);
    this.recheckPending();
    this.emit();
    return ok;
  }

  /**
   * LIST-8: environments' own terminals, every environment or `only` these;
   * one request per set at a time. True when all were listed.
   */
  async refreshEnvironmentScopes(only?: readonly string[]): Promise<boolean> {
    const ids = only ?? (this.environments ?? []).map((env) => env.id);
    const results = await mapLimited(ids, SCAN_CONCURRENCY, (id) =>
      this.single(`own:${id}`, () => this.listOwn(id)),
    );
    this.recheckPending();
    this.emit();
    return results.every(Boolean);
  }

  /** One environment's own terminals; the caller emits. */
  private async listOwn(environmentId: string): Promise<boolean> {
    const visit = this.visit;
    const seq = this.tick();
    let ok = true;
    try {
      const list = await listEnvironmentTerminals(this.sdk, environmentId);
      this.replaceEnvironmentTerminals(environmentId, list, seq);
      if (visit === this.visit) this.environmentErrors.delete(environmentId);
    } catch (error) {
      ok = false;
      if (visit === this.visit) this.environmentErrors.set(environmentId, message(error));
    }
    if (visit === this.visit) this.attempted.add(environmentId);
    return ok;
  }

  /**
   * LIST-8: the full scan of every thread in the project; one at a time per
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
    try {
      if (!(await this.loadEnvironments())) return false;
      if (
        current() &&
        visit === this.visit &&
        this.environments?.some((env) => !this.attempted.has(env.id))
      ) {
        void this.refreshEnvironmentScopes();
      }
      const recordSeq = this.tick();
      const threads = await listAllThreads(this.sdk, { projectId: this.projectId });
      const seqs = new Map<string, number>();
      const terminals = await scanThreadTerminals(this.sdk, threads, undefined, (threadId) =>
        seqs.set(threadId, this.tick()),
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
      if (visit === this.visit) {
        this.threadsScanned = true;
        this.scanError = null;
      }
      this.emit();
      return true;
    } catch (error) {
      if (!current()) return false;
      if (visit === this.visit) this.scanError = message(error);
      this.emit();
      return false;
    }
  }

  /** LIST-30: fetches what a thread's signals asked for; one request per thread. */
  private fetchThreadOnce(threadId: string): Promise<boolean> {
    return this.single(`thread:${threadId}`, () => this.fetchThread(threadId), true);
  }

  private async fetchThread(threadId: string): Promise<boolean> {
    const needs = this.dirtyThreads.get(threadId);
    if (!needs) return true;
    this.dirtyThreads.delete(threadId);
    const seq = this.tick();
    if (needs.deleted) {
      this.dropThread(threadId, seq);
      this.emit();
      return true;
    }
    const withRecord = needs.record || !this.threads.has(threadId);
    const counted = (delta: number) => {
      const count = (this.fetchingRecords.get(threadId) ?? 0) + delta;
      if (count > 0) this.fetchingRecords.set(threadId, count);
      else this.fetchingRecords.delete(threadId);
    };
    if (withRecord) counted(1);
    try {
      const [record, list] = await Promise.all([
        withRecord ? this.sdk.threads.get({ threadId }) : Promise.resolve(null),
        needs.terminals ? listThreadTerminals(this.sdk, threadId) : Promise.resolve(null),
      ]);
      if (record && this.accept(`record:${threadId}`, seq)) this.threads.set(threadId, record);
      if (list) this.replaceThreadTerminals(threadId, list, seq);
      this.emit();
      return true;
    } catch (error) {
      // Gone: as if bb had said so. Anything else: the next full listing settles it.
      if (isNotFound(error)) this.dropThread(threadId, seq);
      this.emit();
      return false;
    } finally {
      if (withRecord) counted(-1);
    }
  }

  /** LIST-30: a deleted thread's terminals are gone; running ones are checked (LIST-11). */
  private dropThread(threadId: string, seq: number): void {
    this.replaceThreadTerminals(threadId, [], seq, this.threads.get(threadId) ?? null);
    if (this.accept(`record:${threadId}`, seq)) this.threads.delete(threadId);
  }

  /**
   * LIST-30: only changes that touch the list are acted on; LIST-31: while
   * away, they are only marked.
   */
  private onThreadChanged(event: ThreadChangedEvent): void {
    const id = event.id;
    if (id === undefined) return;
    const known = this.threads.get(id);
    const inProject =
      known !== undefined ||
      this.threadTerminals.has(id) ||
      event.metadata?.projectId === this.projectId;
    if (!inProject) return;
    const changes = new Set(event.changes);
    const needs = this.dirtyThreads.get(id) ?? { record: false, terminals: false, deleted: false };
    if (changes.has("thread-deleted")) needs.deleted = true;
    if (changes.has("terminals-changed")) needs.terminals = true;
    const recordChanges = RECORD_CHANGES.filter((change) => changes.has(change));
    const status = event.metadata?.statusChange;
    // The signal carries the new status: no request needed, unless a fetch of
    // the thread is pending or running, whose answer must not be thrown away.
    const fetching = (this.fetchingRecords.get(id) ?? 0) > 0 || needs.record;
    if (
      known &&
      status &&
      !fetching &&
      recordChanges.length === 1 &&
      recordChanges[0] === "status-changed"
    ) {
      if (this.accept(`record:${id}`, this.tick())) {
        this.threads.set(id, {
          ...known,
          status: status.status,
          latestAttentionAt: status.latestAttentionAt,
        });
        this.emit();
      }
    } else if (recordChanges.length > 0 && (known || changes.has("thread-created"))) {
      needs.record = true;
    } else if (changes.has("environment-changed")) {
      // A thread moved in from elsewhere brings its terminals along.
      needs.record = true;
    }
    if (changes.has("environment-changed")) needs.terminals = true;
    if (!needs.deleted && !needs.record && !needs.terminals) return;
    this.dirtyThreads.set(id, needs);
    if (this.live) this.debounceThread(id);
  }

  /** Coalesces a thread's signals, but never waits more than SIGNAL_MAX_WAIT_MS. */
  private debounceThread(threadId: string): void {
    const now = Date.now();
    const pending = this.signalTimers.get(threadId);
    if (pending) clearTimeout(pending.timer);
    const first = pending?.first ?? now;
    const wait = Math.max(0, Math.min(SIGNAL_DEBOUNCE_MS, first + SIGNAL_MAX_WAIT_MS - now));
    const timer = setTimeout(() => {
      this.signalTimers.delete(threadId);
      if (this.live) void this.fetchThreadOnce(threadId);
    }, wait);
    this.signalTimers.set(threadId, { timer, first });
  }

  /** LIST-14: an environment was created or deleted, so list them again. */
  private onEnvironmentChanged(event: EnvironmentChangedEvent): void {
    const relevant = event.changes.some(
      (change) => change === "environment-created" || change === "environment-deleted",
    );
    // LIST-31: away, nothing to note: a return lists the environments anyway.
    if (!relevant || !this.live) return;
    void this.loadEnvironments(true).then((ok) => {
      const unlisted = (this.environments ?? [])
        .filter((env) => !this.attempted.has(env.id))
        .map((env) => env.id);
      if (ok && unlisted.length > 0) void this.refreshEnvironmentScopes(unlisted);
    });
  }

  /** LIST-27: the connection dropped, or came back; when back, confirm again. */
  private onConnection(event: ConnectionEvent): void {
    const up = event.state === "connected";
    const was = this.socketUp;
    this.socketUp = up;
    if (up && (event.reconnected || !was)) this.reconnected();
    else if (up !== was) this.emit();
  }

  /**
   * LIST-27: the page's view of the same connection
   * (`useRealtimeConnectionState`); a store made while it is down is not live.
   */
  setConnection(state: "connected" | "connecting" | "reconnecting"): void {
    const up = state === "connected";
    if (up === this.hookUp) return;
    this.hookUp = up;
    if (up) this.reconnected();
    else this.emit();
  }

  private reconnected(): void {
    // Signals may have been missed: everything is last known until confirmed again.
    this.unconfirm();
    if (this.live) void this.returnSequence(this.visit);
  }

  // ── the selected terminal ───────────────────────────────────────────────

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

  /** VIEW-9: the host's home directory, so folders can show `~`. */
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

  /** LIST-11: the user dismissed an exited row; LIST-32: or ended it from the view. */
  dismiss(terminalId: string): void {
    this.forget(terminalId);
  }

  /** ACT-6. A verified close counts as dismissing the row. */
  async close(terminalId: string): Promise<void> {
    await closeTerminal(this.sdk, terminalId);
    this.forget(terminalId);
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

  /** LIST-17: complete this visit; an environment's own list may have failed. */
  private isComplete(): boolean {
    return (
      this.environmentsListed &&
      this.environments !== null &&
      this.threadsScanned &&
      this.environments.every((env) => this.attempted.has(env.id))
    );
  }

  /** LIST-27: complete this visit with nothing failed. */
  private isConfirmed(): boolean {
    return this.isComplete() && this.currentError() === null && this.environmentErrors.size === 0;
  }

  private currentError(): string | null {
    return this.scanError ?? this.environmentsError;
  }

  private computeView(): HubView {
    const connected = this.socketUp && this.hookUp;
    const lastKnown = !connected || (this.returned && !this.confirmed && !this.isConfirmed());
    const section = (env: EnvironmentInfo): Section => {
      const grouped = groupEnvironment(this.snapshotFor(env.id));
      return {
        environment: env,
        grouped,
        rows: tabOrder(grouped),
        running: runningCount(grouped),
        error: this.environmentErrors.get(env.id) ?? null,
      };
    };
    const environments = this.environments === null ? null : environmentInfos(this.environments);
    const sections = (environments ?? []).map(section);
    const failed = this.currentError() !== null || this.environmentErrors.size > 0;
    return {
      projectId: this.projectId,
      environments,
      sections,
      rows: sections.flatMap((s) => s.rows),
      running: sections.reduce((sum, s) => sum + s.running, 0),
      hints: new Map(this.hints),
      homes: new Map(this.homes),
      error: this.currentError(),
      failed,
      complete: this.isComplete() && !lastKnown,
      succeeded: this.isConfirmed() && !lastKnown,
      ready: this.everListed || this.currentError() !== null,
      lastKnown,
      reconnecting: !connected,
      vanished: new Set(this.vanished),
    };
  }
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * LIST-34: the last segment of `path` that differs from the segment at the
 * same distance from the end in every other path; null when none does.
 */
export function distinguishingSegment(path: string, others: readonly string[]): string | null {
  const own = segments(path);
  const rest = others.map(segments);
  for (let back = 1; back <= own.length; back++) {
    const segment = own[own.length - back];
    if (rest.every((other) => other[other.length - back] !== segment)) return segment ?? null;
  }
  return null;
}

/**
 * LIST-34: each environment's name as the page shows it. Names shared within
 * the project are followed by " · " and the part of the path that tells them
 * apart.
 */
export function environmentInfos(environments: readonly EnvironmentRecord[]): EnvironmentInfo[] {
  const base = environments.map(environmentName);
  return environments.map((env, index) => {
    const name = base[index] ?? env.id;
    const path = env.path ?? "";
    const others = environments
      .filter((_, i) => i !== index && base[i] === name)
      .map((other) => other.path ?? "");
    const suffix = others.length > 0 ? distinguishingSegment(path, others) : null;
    return {
      id: env.id,
      name: suffix ? `${name} · ${suffix}` : name,
      path,
      hostId: env.hostId,
    };
  });
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
