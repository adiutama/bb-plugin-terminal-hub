// What the Terminals page's title-bar button and the page share about
// services (ADR 202610171823): which main view is shown, and the latest list.
// bb mounts the navPanel's `headerContent` apart from the page, so they meet
// here rather than through props. Kept until bb reloads; never in the URL
// (SVC-21).
import type { ServicesList } from "./services-contract";

export type MainView = "terminals" | "services";

export interface ServicesSnapshot {
  /** SVC-1: what the main view, right of the rail, shows. */
  view: MainView;
  /** The latest list; null until first scanned. */
  list: ServicesList | null;
  /** Why the latest scan failed, if it did. */
  error: string | null;
  /** When the latest scan finished, in ms; 0 before the first. */
  scannedAt: number;
  /** Bumped to ask for a scan now. */
  nonce: number;
}

type Listener = () => void;

export class ServicesStore {
  private snapshot: ServicesSnapshot = {
    view: "terminals",
    list: null,
    error: null,
    scannedAt: 0,
    nonce: 0,
  };
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ServicesSnapshot => this.snapshot;

  /**
   * SVC-1: switches the main view; switching adds no history entry (SVC-21).
   * Showing Services scans at once (SVC-10).
   */
  setView(view: MainView): void {
    if (this.snapshot.view === view) return;
    this.update(view === "services" ? { view, nonce: this.snapshot.nonce + 1 } : { view });
  }

  toggleView(): void {
    this.setView(this.snapshot.view === "services" ? "terminals" : "services");
  }

  scanned(list: ServicesList, at: number): void {
    this.update({ list, error: null, scannedAt: at });
  }

  failed(error: string, at: number): void {
    this.update({ error, scannedAt: at });
  }

  /** Asks the page for a scan now. */
  refresh(): void {
    this.update({ nonce: this.snapshot.nonce + 1 });
  }

  private update(patch: Partial<ServicesSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

const stores = new WeakMap<object, ServicesStore>();

/** The store for this bb app; `useSdk()` is stable for the plugin's lifetime. */
export function servicesStoreFor(sdk: object): ServicesStore {
  let store = stores.get(sdk);
  if (!store) {
    store = new ServicesStore();
    stores.set(sdk, store);
  }
  return store;
}
