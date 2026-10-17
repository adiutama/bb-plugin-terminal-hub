// LIST-48: whether an environment's folder still exists, so "New terminal
// in…" offers only places a shell can start. Checked on the environment's
// host when a menu opens; kept until bb reloads.
import type { EnvironmentInfo, HubSdk } from "./hub-store";

/** `checking` until bb answers; `kept` when the check failed for another reason. */
export type FolderState = "checking" | "exists" | "missing" | "kept";

/** `hosts.directory` reports a missing folder as `ENOENT` (see the 2026-10-17 finding). */
export function isMissingFolder(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code === "ENOENT") return true;
  return typeof record.message === "string" && /\bENOENT\b/.test(record.message);
}

type Listener = () => void;

export class FolderChecks {
  private states = new Map<string, FolderState>();
  private snapshot: ReadonlyMap<string, FolderState> = new Map();
  private listeners = new Set<Listener>();

  constructor(private readonly sdk: Pick<HubSdk, "hosts">) {}

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get = (): ReadonlyMap<string, FolderState> => this.snapshot;

  /** Checks each environment not checked since bb loaded. */
  check(environments: readonly EnvironmentInfo[]): void {
    let started = false;
    for (const env of environments) {
      if (this.states.has(env.id)) continue;
      started = true;
      this.states.set(env.id, "checking");
      this.sdk.hosts.directory({ hostId: env.hostId, path: env.path }).then(
        () => this.set(env.id, "exists"),
        (error: unknown) => this.set(env.id, isMissingFolder(error) ? "missing" : "kept"),
      );
    }
    if (started) this.emit();
  }

  private set(environmentId: string, state: FolderState): void {
    this.states.set(environmentId, state);
    this.emit();
  }

  private emit(): void {
    this.snapshot = new Map(this.states);
    for (const listener of this.listeners) listener();
  }
}

const checks = new WeakMap<object, FolderChecks>();

/** The page's folder checks; `useSdk()` is stable for the plugin's lifetime. */
export function folderChecksFor(sdk: Pick<HubSdk, "hosts">): FolderChecks {
  let found = checks.get(sdk);
  if (!found) {
    found = new FolderChecks(sdk);
    checks.set(sdk, found);
  }
  return found;
}

export interface MenuEnvironments {
  /** What the menu lists now. */
  shown: EnvironmentInfo[];
  /** Environments with no terminals whose folder is not checked yet. */
  unchecked: EnvironmentInfo[];
  /** A check is running or about to: the menu says "Checking folders…". */
  checking: boolean;
}

/**
 * LIST-48: an environment with terminals is always listed; one without is
 * listed once its folder is known to exist, or its check failed for another
 * reason. A missing folder is left out.
 */
export function menuEnvironments(
  environments: readonly EnvironmentInfo[],
  hasTerminals: (environmentId: string) => boolean,
  states: ReadonlyMap<string, FolderState>,
): MenuEnvironments {
  const shown: EnvironmentInfo[] = [];
  const unchecked: EnvironmentInfo[] = [];
  let checking = false;
  for (const env of environments) {
    if (hasTerminals(env.id)) {
      shown.push(env);
      continue;
    }
    const state = states.get(env.id);
    if (state === undefined) unchecked.push(env);
    if (state === "exists" || state === "kept") shown.push(env);
    else if (state !== "missing") checking = true;
  }
  return { shown, unchecked, checking };
}
