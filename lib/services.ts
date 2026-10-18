// The Services page's server side: which listening processes belong to bb's
// environments (SVC-2, SVC-3), who started them (SVC-18), which set they
// belong to (SVC-25 to SVC-28), and stopping them (SVC-8, SVC-9, SVC-13,
// SVC-19). Runs in the server entry, on the machine
// running bb; the page and `bb terminal-hub services` both read it.
import type { EnvironmentRecord } from "./hub-store";
import { environmentInfos, message } from "./hub-store";
import {
  type BbVariables,
  type Listener,
  listProcesses,
  type ProcessHost,
  type ProcessInfo,
  protectedPids,
  readFiles,
  readVariables,
  scanListeners,
} from "./processes";
import { readRecord, type ServiceRecord } from "./service-record";
import type {
  Connect,
  Service,
  ServiceGroup,
  ServicesList,
  StopExpectation,
  StopPlan,
} from "./services-contract";

/** SVC-5: how much of a log the drawer shows. */
export const LOG_TAIL_BYTES = 64 * 1024;
/** SVC-18: how long a thread's title is reused before it is fetched again. */
const TITLE_TTL_MS = 60_000;

export interface ServicesSdk {
  projects: { list(): Promise<{ id: string; name: string }[]> };
  environments: { list(args: { projectId: string }): Promise<EnvironmentRecord[]> };
  threads: {
    get(args: {
      threadId: string;
    }): Promise<{ title: string | null; titleFallback?: string | null }>;
  };
  system: { config(): Promise<{ primaryHostId: string | null }> };
}

interface IndexedEnvironment {
  projectId: string;
  projectName: string;
  id: string;
  name: string;
  path: string;
  hostId: string;
}

/** bb's projects and environments, in bb's order (LIST-33), named as LIST-34 names them. */
export interface EnvironmentIndex {
  environments: IndexedEnvironment[];
  /** SVC-11: the host bb runs on; null when bb does not say. */
  localHostId: string | null;
  error: string | null;
}

/** Whether `folder` is `path` or inside it. */
function within(folder: string, path: string): boolean {
  if (path === "") return false;
  const base = path.endsWith("/") ? path.slice(0, -1) : path;
  return folder === base || folder.startsWith(`${base}/`);
}

/**
 * SVC-2: the environment a process on this machine belongs to: the one its
 * `BB_ENVIRONMENT_ID` names, when bb knows it; else the one whose folder holds
 * its working folder (the deepest, when environments nest). Only environments
 * on this machine count.
 */
export function environmentOf(
  index: EnvironmentIndex,
  cwd: string | null,
  variables: BbVariables | null,
): string | null {
  const local = index.environments.filter((env) => env.hostId === index.localHostId);
  const named = variables?.environmentId;
  if (named && local.some((env) => env.id === named)) return named;
  if (cwd === null) return null;
  let best: IndexedEnvironment | null = null;
  for (const env of local) {
    if (within(cwd, env.path) && (best === null || env.path.length > best.path.length)) best = env;
  }
  return best?.id ?? null;
}

interface Listed {
  service: Service;
}

/**
 * SVC-27: each record read in one scan, by path, so a set's record is read
 * once; and the listed services waiting for their set, filled in together.
 */
interface RecordReads {
  byPath: Map<string, Promise<ServiceRecord | null>>;
  pending: Promise<void>[];
}

/**
 * SVC-25: within an environment, each set's rows together and by port, sets
 * ordered by their lowest port; unlabelled rows after them, by port.
 */
export function orderServices(services: readonly Service[]): Service[] {
  const firstPort = (service: Service) => service.ports[0] ?? 0;
  const setPort = new Map<string, number>();
  for (const service of services) {
    if (!service.set) continue;
    const known = setPort.get(service.set.record);
    if (known === undefined || firstPort(service) < known) {
      setPort.set(service.set.record, firstPort(service));
    }
  }
  return [...services].sort((a, b) => {
    if (a.set && b.set) {
      const set =
        (setPort.get(a.set.record) ?? 0) - (setPort.get(b.set.record) ?? 0) ||
        a.set.record.localeCompare(b.set.record);
      if (set !== 0) return set;
    } else if (a.set || b.set) {
      return a.set ? -1 : 1;
    }
    return firstPort(a) - firstPort(b) || a.pid - b.pid;
  });
}

type Target =
  | { kind: "changed" }
  | { kind: "group"; service: Service; pgid: number; members: ProcessInfo[] }
  | { kind: "process"; service: Service; process: ProcessInfo };

/** SVC-19: the signal's target, as `plan` describes it. */
function describe(target: Exclude<Target, { kind: "changed" }>): StopExpectation {
  return target.kind === "group"
    ? { scope: "group", target: target.pgid, count: target.members.length }
    : { scope: "process", target: target.process.pid, count: 1 };
}

export class Services {
  /** SVC-13: what the latest scan listed, by PID. */
  private latest = new Map<number, Listed>();
  /**
   * SVC-9: listeners sent SIGTERM from here. While one is alive with the same
   * start time it stays listed, so it can be force-stopped even after it
   * closed its port.
   */
  private stopped = new Map<number, Service>();
  private index: EnvironmentIndex | null = null;
  private localHostId: Promise<string | null> | null = null;
  private titles = new Map<string, { at: number; title: Promise<string | null> }>();

  constructor(
    private readonly sdk: ServicesSdk,
    private readonly host: ProcessHost,
    private readonly now: () => number = Date.now,
  ) {}

  /** SVC-2 to SVC-4, SVC-11, SVC-12, SVC-14, SVC-18: scans and lists. */
  async list(): Promise<ServicesList> {
    const [index, scan] = await Promise.all([this.loadIndex(), scanListeners(this.host)]);
    this.index = index;
    if (!scan.available) {
      this.latest = new Map();
      return {
        available: false,
        hostKnown: index.localHostId !== null,
        groups: [],
        error: index.error,
      };
    }
    const byEnvironment = new Map<string, Service[]>();
    const latest = new Map<number, Listed>();
    const records: RecordReads = { byPath: new Map(), pending: [] };
    for (const listener of scan.listeners) {
      const service = await this.serviceFor(index, listener, records);
      if (!service) continue;
      latest.set(service.pid, { service });
      const services = byEnvironment.get(service.environmentId) ?? [];
      services.push(service);
      byEnvironment.set(service.environmentId, services);
    }
    // SVC-27: different sets' records are read at once, each within its timeout.
    await Promise.all(records.pending);
    for (const service of await this.stillStopping(latest)) {
      latest.set(service.pid, { service });
      const services = byEnvironment.get(service.environmentId) ?? [];
      services.push(service);
      byEnvironment.set(service.environmentId, services);
    }
    this.latest = latest;
    const groups: ServiceGroup[] = [];
    for (const env of index.environments) {
      const group = {
        projectId: env.projectId,
        projectName: env.projectName,
        environmentId: env.id,
        environmentName: env.name,
      };
      // SVC-11: another host's processes are not looked at.
      if (env.hostId !== index.localHostId) {
        groups.push({ ...group, checked: false, services: [] });
        continue;
      }
      const services = byEnvironment.get(env.id);
      if (!services) continue;
      groups.push({ ...group, checked: true, services: orderServices(services) });
    }
    return {
      available: true,
      hostKnown: index.localHostId !== null,
      groups,
      error: index.error,
    };
  }

  /** SVC-19: what Stop would signal, after the identity check. */
  async plan(pid: number, startedAt: number): Promise<StopPlan> {
    const target = await this.target(pid, startedAt);
    if (target.kind === "changed") return { outcome: "changed" };
    const processes = target.kind === "group" ? target.members : [target.process];
    const { scope, target: id } = describe(target);
    return {
      outcome: "ready",
      scope,
      target: id,
      commands: processes.map((process) => process.command),
    };
  }

  /**
   * SVC-8, SVC-9, SVC-13, SVC-19: re-checks that `pid` was listed in the
   * latest scan and still has the start time listed, then sends SIGTERM (or
   * SIGKILL with `force`) to its group or to it alone: only when that is still
   * what `expected` (the plan the user confirmed) says.
   */
  async stop(
    pid: number,
    startedAt: number,
    force: boolean,
    expected: StopExpectation,
  ): Promise<{ outcome: "changed" } | { outcome: "signalled"; count: number }> {
    const target = await this.target(pid, startedAt);
    if (target.kind === "changed") return { outcome: "changed" };
    const now = describe(target);
    if (
      now.scope !== expected.scope ||
      now.target !== expected.target ||
      now.count !== expected.count
    ) {
      return { outcome: "changed" };
    }
    const signal = force ? "SIGKILL" : "SIGTERM";
    try {
      if (target.kind === "group") this.host.kill(-target.pgid, signal);
      else this.host.kill(target.process.pid, signal);
    } catch (error) {
      // Ended between the check and the signal.
      if ((error as { code?: string }).code === "ESRCH") return { outcome: "changed" };
      throw error;
    }
    if (!force) this.stopped.set(pid, target.service);
    return {
      outcome: "signalled",
      count: target.kind === "group" ? target.members.length : 1,
    };
  }

  /** SVC-5, SVC-16: the last 64 KB of a listed process's log file. */
  async log(
    pid: number,
    startedAt: number,
  ): Promise<
    | { outcome: "ended" }
    | { outcome: "none" }
    | { outcome: "log"; path: string; text: string; error: string | null }
  > {
    const listed = this.latest.get(pid);
    if (!listed || listed.service.startedAt !== startedAt) return { outcome: "ended" };
    const path = listed.service.logPath;
    if (path === null) return { outcome: "none" };
    try {
      const tail = await this.host.readTail(path, LOG_TAIL_BYTES);
      // A tail cut mid-line starts at the next whole line.
      const text = tail.truncated ? tail.text.slice(tail.text.indexOf("\n") + 1) : tail.text;
      return { outcome: "log", path, text, error: null };
    } catch (error) {
      return { outcome: "log", path, text: "", error: message(error) };
    }
  }

  /**
   * SVC-28: the URLs of a listed process's entry in its record, and the set's
   * credentials, as the record says now. Only for a process the latest scan
   * listed, by the labels it was listed with.
   */
  async connect(pid: number, startedAt: number): Promise<Connect> {
    const listed = this.latest.get(pid);
    if (!listed || listed.service.startedAt !== startedAt) return { outcome: "ended" };
    const { name, set } = listed.service;
    if (name === null || set === null) return { outcome: "none" };
    const record = await readRecord(this.host, set.record);
    const entry = record?.services.find((service) => service.name === name);
    if (!record || !entry) return { outcome: "none" };
    return { outcome: "connect", urls: entry.urls, credentials: record.credentials };
  }

  // ── internals ─────────────────────────────────────────────────────────

  /**
   * SVC-2, SVC-3, SVC-18: the listener as a listed process, or null when it
   * is not one. SVC-25, SVC-26, SVC-30: its labels and record only name it,
   * once it is listed.
   */
  private async serviceFor(
    index: EnvironmentIndex,
    listener: Listener,
    records: RecordReads,
  ): Promise<Service | null> {
    if (listener.ports.length === 0) return null;
    // SVC-3: in a terminal, a bb one or any other.
    if (listener.tty !== null || listener.variables?.terminalSessionId) return null;
    const environmentId = environmentOf(index, listener.cwd, listener.variables);
    if (environmentId === null) return null;
    const threadId = listener.variables?.threadId ?? null;
    const service: Service = {
      pid: listener.pid,
      ports: listener.ports,
      command: listener.command,
      startedAt: listener.startedAt,
      environmentId,
      threadId,
      threadTitle: threadId ? await this.threadTitle(threadId) : null,
      logPath: listener.logPath,
      name: listener.variables?.serviceName ?? null,
      set: null,
    };
    const record = listener.variables?.serviceRecord ?? null;
    if (record !== null) {
      records.pending.push(
        this.setOf(record, records).then((set) => {
          service.set = set;
        }),
      );
    }
    return service;
  }

  /** SVC-25, SVC-27: the set a record path names, with its title when readable. */
  private async setOf(path: string, records: RecordReads): Promise<NonNullable<Service["set"]>> {
    let read = records.byPath.get(path);
    if (!read) {
      read = readRecord(this.host, path);
      records.byPath.set(path, read);
    }
    const record = await read;
    return {
      record: path,
      id: record?.id ?? null,
      title: record?.title ?? null,
      case: record?.case ?? null,
    };
  }

  /**
   * SVC-8, SVC-13, SVC-19, SVC-22: what a signal to `pid` reaches. Only a PID
   * the latest scan listed, still with the start time it listed, and never
   * one of bb's. Its whole group when the group's leader is gone, listed, or
   * in the same environment, and every member is known: its environment was
   * read, it has no terminal and no `BB_TERMINAL_SESSION_ID`, and it is not
   * bb's. Else the listener alone.
   */
  private async target(pid: number, startedAt: number): Promise<Target> {
    const listed = this.latest.get(pid);
    if (!listed || listed.service.startedAt !== startedAt || pid <= 1) return { kind: "changed" };
    const all = await listProcesses(this.host, null);
    const process = all.find((p) => p.pid === pid);
    if (!process || process.startedAt !== startedAt) return { kind: "changed" };
    const bbs = protectedPids(all, this.host.selfPid, this.host.bbExecutable);
    if (bbs.has(pid)) return { kind: "changed" };
    const service = listed.service;
    const alone: Target = { kind: "process", service, process };
    const pgid = process.pgid;
    // Never init's group.
    if (pgid <= 1) return alone;
    const members = all.filter((p) => p.pgid === pgid);
    if (members.some((member) => member.tty !== null || bbs.has(member.pid))) return alone;
    const variables = await readVariables(this.host, members);
    const known = members.every((member) => {
      const vars = variables.get(member.pid);
      return vars !== null && vars !== undefined && !vars.terminalSessionId;
    });
    if (!known) return alone;
    const leader = members.find((member) => member.pid === pgid);
    if (leader && !(await this.leaderBelongs(leader, service, variables))) return alone;
    return { kind: "group", service, pgid, members };
  }

  /**
   * SVC-9: listeners stopped from here that the scan no longer found (a
   * process can close its port before it exits) but that still run with the
   * start time they were listed with. The others are forgotten.
   */
  private async stillStopping(found: ReadonlyMap<number, Listed>): Promise<Service[]> {
    for (const [pid, service] of this.stopped) {
      const now = found.get(pid);
      if (now && now.service.startedAt !== service.startedAt) this.stopped.delete(pid);
    }
    const missing = [...this.stopped.values()].filter((service) => !found.has(service.pid));
    if (missing.length === 0) return [];
    const alive = await listProcesses(
      this.host,
      missing.map((service) => service.pid),
    );
    return missing.filter((service) => {
      const running = alive.some((p) => p.pid === service.pid && p.startedAt === service.startedAt);
      if (!running) this.stopped.delete(service.pid);
      return running;
    });
  }

  /** SVC-19: the group's leader is listed, or belongs to the listener's environment. */
  private async leaderBelongs(
    leader: ProcessInfo,
    service: Service,
    variables: ReadonlyMap<number, BbVariables | null>,
  ): Promise<boolean> {
    const listed = this.latest.get(leader.pid);
    if (listed && listed.service.startedAt === leader.startedAt) return true;
    if (!this.index) return false;
    const files = await readFiles(this.host, [leader.pid]);
    const cwd = files.get(leader.pid)?.cwd ?? null;
    return (
      environmentOf(this.index, cwd, variables.get(leader.pid) ?? null) === service.environmentId
    );
  }

  private async loadIndex(): Promise<EnvironmentIndex> {
    const localHostId = await this.loadLocalHost();
    let projects: { id: string; name: string }[];
    try {
      projects = await this.sdk.projects.list();
    } catch (error) {
      return { environments: this.index?.environments ?? [], localHostId, error: message(error) };
    }
    let error: string | null = null;
    const lists = await Promise.all(
      projects.map(async (project) => {
        try {
          const records = (await this.sdk.environments.list({ projectId: project.id })).filter(
            (env) => env.status !== "destroyed",
          );
          return environmentInfos(records).map((info) => ({
            projectId: project.id,
            projectName: project.name,
            ...info,
          }));
        } catch (cause) {
          error = message(cause);
          // Keep what the last scan knew of it.
          return (this.index?.environments ?? []).filter((env) => env.projectId === project.id);
        }
      }),
    );
    return { environments: lists.flat(), localHostId, error };
  }

  /** SVC-11: `primaryHostId`, bb's own machine; asked again until bb answers. */
  private loadLocalHost(): Promise<string | null> {
    if (!this.localHostId) {
      this.localHostId = this.sdk.system.config().then(
        (config) => config.primaryHostId,
        () => null,
      );
      void this.localHostId.then((id) => {
        if (id === null) this.localHostId = null;
      });
    }
    return this.localHostId;
  }

  /** SVC-18: the thread's title, or null when bb does not know the thread. */
  private threadTitle(threadId: string): Promise<string | null> {
    const cached = this.titles.get(threadId);
    if (cached && this.now() - cached.at < TITLE_TTL_MS) return cached.title;
    const title = this.sdk.threads.get({ threadId }).then(
      (thread) => thread.title ?? thread.titleFallback ?? "Untitled thread",
      () => null,
    );
    this.titles.set(threadId, { at: this.now(), title });
    return title;
  }
}
