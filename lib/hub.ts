// Every project's store together, for the Terminals page and its title bar.
//
// While the page is shown, every project's store runs (LIST-8), and the one
// holding the selected environment polls it more often. The title bar reads
// the same snapshot and never starts requests of its own.
import {
  createGate,
  type Gate,
  type HubSdk,
  type HubStore,
  type HubView,
  hubStoreFor,
  message,
  OPEN_GATE,
} from "./hub-store";

export interface ProjectRecord {
  id: string;
  name: string;
}

/** What the URL selects. */
export interface Selection {
  projectId: string | null;
  environmentId: string | null;
  terminalId: string | null;
}

export interface HubSnapshot {
  /** bb's projects in bb's order; null until first listed. */
  projects: ProjectRecord[] | null;
  projectsError: string | null;
  /** Each listed project's view, by project id. */
  views: ReadonlyMap<string, HubView>;
  /** LIST-27: something shown is kept from before a return, not yet confirmed. */
  lastKnown: boolean;
  /** LIST-17, LIST-25: every project's listing has succeeded this visit. */
  succeeded: boolean;
  /** LIST-25: a listing failed this visit. */
  failed: boolean;
  /**
   * LIST-17: the first full listing since bb loaded, while it runs: how many
   * projects are listed of how many. Null once done.
   */
  progress: { listed: number; total: number | null } | null;
}

type Listener = () => void;

export class Hub {
  private projects: ProjectRecord[] | null = null;
  private projectsError: string | null = null;
  private selection: Selection = { projectId: null, environmentId: null, terminalId: null };
  private attachments = 0;
  private detachers = new Map<string, () => void>();
  private gate: Gate = OPEN_GATE;
  private watched = new Set<string>();
  private listeners = new Set<Listener>();
  private snapshot: HubSnapshot | null = null;
  /** LIST-17: every project was listed once since bb loaded. */
  private everListed = false;

  constructor(private readonly sdk: HubSdk) {}

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): HubSnapshot => {
    if (this.snapshot === null) this.snapshot = this.compute();
    return this.snapshot;
  };

  /** The project's store, watched so the snapshot follows it. */
  storeFor(projectId: string): HubStore {
    const store = hubStoreFor(this.sdk, projectId);
    if (!this.watched.has(projectId)) {
      this.watched.add(projectId);
      store.subscribe(this.changed);
    }
    return store;
  }

  /**
   * The page is shown with `selection`: every project's store starts. On a
   * return, the selected project goes first (LIST-28). Returns the detach
   * function; detaching and attaching in the same tick is not a return.
   */
  attach(selection: Selection): () => void {
    this.attachments++;
    this.selection = selection;
    if (this.attachments === 1) {
      this.gate = selection.environmentId === null ? OPEN_GATE : createGate();
      this.attachStores();
      void this.loadProjects();
    }
    this.changed();
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      this.attachments--;
      if (this.attachments > 0) return;
      for (const detach of this.detachers.values()) detach();
      this.detachers.clear();
    };
  }

  /** The URL's selection changed. */
  select(selection: Selection): void {
    this.selection = selection;
    if (this.attachments === 0) return;
    for (const projectId of this.detachers.keys()) {
      const own = projectId === selection.projectId;
      this.storeFor(projectId).select(
        own ? selection.environmentId : null,
        own ? selection.terminalId : null,
      );
    }
    this.attachStores();
    this.changed();
  }

  /** LIST-27: bb's realtime connection as the page's hook sees it. */
  setConnection(state: "connected" | "connecting" | "reconnecting"): void {
    for (const projectId of this.watched) this.storeFor(projectId).setConnection(state);
  }

  /** The selected project first, then every listed project in bb's order. */
  private attachStores(): void {
    if (this.attachments === 0) return;
    const ids = [
      ...(this.selection.projectId ? [this.selection.projectId] : []),
      ...(this.projects ?? []).map((project) => project.id),
    ];
    for (const projectId of ids) {
      if (this.detachers.has(projectId)) continue;
      const own = projectId === this.selection.projectId;
      this.detachers.set(
        projectId,
        this.storeFor(projectId).attach(
          own ? this.selection.environmentId : null,
          own ? this.selection.terminalId : null,
          this.gate,
        ),
      );
    }
  }

  /** bb's projects, listed again on each visit. */
  private async loadProjects(): Promise<void> {
    try {
      this.projects = await this.sdk.projects.list();
      this.projectsError = null;
    } catch (error) {
      this.projectsError = message(error);
    }
    this.attachStores();
    this.changed();
  }

  private readonly changed = () => {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  };

  private compute(): HubSnapshot {
    const views = new Map<string, HubView>();
    for (const project of this.projects ?? []) {
      views.set(project.id, this.storeFor(project.id).getView());
    }
    const all = [...views.values()];
    const listed = this.projects !== null && this.projectsError === null;
    if (listed && all.every((view) => view.ready)) this.everListed = true;
    return {
      projects: this.projects,
      projectsError: this.projectsError,
      views,
      lastKnown: all.some((view) => view.lastKnown),
      succeeded: listed && all.every((view) => view.succeeded),
      failed: this.projectsError !== null || all.some((view) => view.failed),
      progress: this.everListed
        ? null
        : {
            listed: all.filter((view) => view.ready).length,
            total: this.projects?.length ?? null,
          },
    };
  }
}

const hubs = new WeakMap<object, Hub>();

/** The page's hub; `useSdk()` is stable for the plugin's lifetime. */
export function hubFor(sdk: HubSdk): Hub {
  let hub = hubs.get(sdk);
  if (!hub) {
    hub = new Hub(sdk);
    hubs.set(sdk, hub);
  }
  return hub;
}
