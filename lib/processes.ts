// What `lsof` and `ps` say about the processes on the machine running bb:
// TCP listeners, their start time, working folder, standard output, and bb
// environment variables (finding 2026-10-17-what-marks-a-process-as-bb-started).
//
// Everything goes through a ProcessHost, so tests run on recorded output and
// never touch, or signal, a real process.

/** Raised by `exec` when the command is not installed. */
export class CommandMissing extends Error {
  constructor(readonly command: string) {
    super(`${command} is not available on this machine`);
  }
}

/** The machine running bb, as far as the Services page needs it. */
export interface ProcessHost {
  platform: string;
  /** This server's own PID: it, its ancestors, and their groups are bb's (SVC-22). */
  selfPid: number;
  /**
   * bb's executable (the server's `process.execPath`): processes running it
   * are bb's (SVC-22). Null when the server runs on a plain JavaScript
   * runtime, which would match every Node server.
   */
  bbExecutable: string | null;
  /**
   * Runs `command` with `args` (no shell) and resolves its standard output,
   * also when it exits non-zero (`lsof` does when it finds nothing). Rejects
   * with CommandMissing when the command is not installed.
   */
  exec(command: "lsof" | "ps", args: readonly string[]): Promise<string>;
  /** A whole small file, such as `/proc/<pid>/environ`. */
  readFile(path: string): Promise<string>;
  /** SVC-27: this server's user id, to tell whose a record is; null where there is none. */
  uid: number | null;
  /**
   * SVC-27: a file opened without following a symlink at its last component,
   * with its owner and size; its text only when it is a regular file of at
   * most `maxBytes` bytes. Rejects when it cannot be opened.
   */
  readRegularFile(path: string, maxBytes: number): Promise<OpenedFile>;
  /** Up to the last `bytes` bytes of a file, and whether it holds more. */
  readTail(path: string, bytes: number): Promise<{ text: string; truncated: boolean }>;
  /** A signal to a PID, or to a process group when `target` is negative. */
  kill(target: number, signal: "SIGTERM" | "SIGKILL"): void;
}

/** What `readRegularFile` found at a path. */
export type OpenedFile =
  | { kind: "symlink" }
  /** A folder, a FIFO, a device: anything but a regular file. */
  | { kind: "other" }
  /** `text` is null when the file holds more than the bytes asked for. */
  | { kind: "file"; uid: number; size: number; text: string | null };

/** A process as `ps` lists it. */
export interface ProcessInfo {
  pid: number;
  ppid: number;
  pgid: number;
  /** SVC-3: the controlling terminal (`ttys004`, `pts/2`); null without one. */
  tty: string | null;
  /** Start time in ms, to the second. */
  startedAt: number;
  command: string;
}

/**
 * The bb variables a process started with, and the agent service record's
 * labels (ADR 202610180513); null when they cannot be read.
 */
export interface BbVariables {
  environmentId: string | null;
  threadId: string | null;
  terminalSessionId: string | null;
  /** SVC-25: `AGENT_SERVICE_RECORD`, the set's `services.json`, as given. */
  serviceRecord: string | null;
  /** SVC-26: `AGENT_SERVICE_NAME`, the process's name in its set. */
  serviceName: string | null;
}

export interface Listener extends ProcessInfo {
  ports: number[];
  cwd: string | null;
  /** Standard output, when it is a regular file. */
  logPath: string | null;
  variables: BbVariables | null;
}

/** SVC-12: either the listeners, or detection is unavailable. */
export type ListenerScan = { available: true; listeners: Listener[] } | { available: false };

/**
 * SVC-2, SVC-20: `lsof -F pcn` output for TCP listeners, as PID → command
 * and ports. Unix sockets are not asked for, so they never appear.
 */
export function parseListeners(output: string): Map<number, Set<number>> {
  const ports = new Map<number, Set<number>>();
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      pid = Number(value);
      if (!Number.isInteger(pid) || pid <= 0) pid = null;
    } else if (field === "n" && pid !== null) {
      const match = /:(\d+)$/.exec(value);
      if (!match) continue;
      let set = ports.get(pid);
      if (!set) {
        set = new Set();
        ports.set(pid, set);
      }
      set.add(Number(match[1]));
    }
  }
  return ports;
}

const PS_LINE =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{1,2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/;

/** What `ps -o tty` prints for a process without a controlling terminal. */
const NO_TTY = new Set(["?", "??", "-"]);

/** `ps -o pid=,ppid=,pgid=,tty=,lstart=,command=` output, run with `LC_ALL=C`. */
export function parseProcesses(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of output.split("\n")) {
    const match = PS_LINE.exec(line);
    if (!match) continue;
    const startedAt = Date.parse((match[5] ?? "").replace(/\s+/g, " "));
    if (Number.isNaN(startedAt)) continue;
    const tty = match[4] ?? "";
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      tty: NO_TTY.has(tty) ? null : tty,
      startedAt,
      command: (match[6] ?? "").trimEnd(),
    });
  }
  return processes;
}

/**
 * SVC-22: bb's own processes: the server running this plugin, its ancestors
 * up to (not including) PID 1, every process in their process groups, and
 * every process running bb's executable. Never listed, never signalled.
 */
export function protectedPids(
  all: readonly ProcessInfo[],
  selfPid: number,
  bbExecutable: string | null,
): Set<number> {
  const byPid = new Map(all.map((p) => [p.pid, p]));
  const pids = new Set<number>();
  const groups = new Set<number>();
  let pid = selfPid;
  while (pid > 1 && !pids.has(pid)) {
    pids.add(pid);
    const process = byPid.get(pid);
    if (!process) break;
    if (process.pgid > 1) groups.add(process.pgid);
    pid = process.ppid;
  }
  for (const process of all) {
    if (groups.has(process.pgid)) pids.add(process.pid);
    const command = process.command;
    if (bbExecutable && (command === bbExecutable || command.startsWith(`${bbExecutable} `))) {
      pids.add(process.pid);
    }
  }
  return pids;
}

/** `lsof -a -p … -d cwd,1 -F ftn` output: each PID's working folder and log file. */
export function parseFiles(
  output: string,
): Map<number, { cwd: string | null; log: string | null }> {
  const files = new Map<number, { cwd: string | null; log: string | null }>();
  let entry: { cwd: string | null; log: string | null } | null = null;
  let fd = "";
  let type = "";
  for (const line of output.split("\n")) {
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      entry = { cwd: null, log: null };
      files.set(Number(value), entry);
    } else if (field === "f") {
      fd = value;
      type = "";
    } else if (field === "t") {
      type = value;
    } else if (field === "n" && entry) {
      if (fd === "cwd") entry.cwd = value;
      // SVC-5: only a regular file is a log; a pipe, a TTY, or /dev/null is not.
      else if (fd === "1" && type === "REG") entry.log = value;
    }
  }
  return files;
}

/** The bb variables and service labels in `KEY=value` pairs; null when no pair was readable. */
export function bbVariables(pairs: readonly string[]): BbVariables | null {
  const values = new Map<string, string>();
  for (const pair of pairs) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(pair);
    if (match?.[1] !== undefined) values.set(match[1], match[2] ?? "");
  }
  if (values.size === 0) return null;
  return {
    environmentId: values.get("BB_ENVIRONMENT_ID") || null,
    threadId: values.get("BB_THREAD_ID") || null,
    terminalSessionId: values.get("BB_TERMINAL_SESSION_ID") || null,
    serviceRecord: values.get("AGENT_SERVICE_RECORD") || null,
    serviceName: values.get("AGENT_SERVICE_NAME") || null,
  };
}

/**
 * macOS: `ps eww -o pid=,command=` prints each command followed by its
 * environment, pairs separated by spaces. The command is known from `ps`, so
 * what follows it is the environment. bb's ids hold no spaces; a value that
 * does (a record's path under `Application Support`) runs until the next
 * `KEY=`.
 */
export function parseEnvironments(
  output: string,
  commands: ReadonlyMap<number, string>,
): Map<number, BbVariables | null> {
  const found = new Map<number, BbVariables | null>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s(.*)$/s.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const rest = match[2] ?? "";
    const command = commands.get(pid);
    const tail = command && rest.startsWith(command) ? rest.slice(command.length) : rest;
    found.set(pid, bbVariables(tail.trim().split(/ +(?=[A-Za-z_][A-Za-z0-9_]*=)/)));
  }
  return found;
}

const RUN_AS = ["-ww", "-o", "pid=,ppid=,pgid=,tty=,lstart=,command="];

/** The processes with these PIDs (all of them when `pids` is null). */
export async function listProcesses(
  host: ProcessHost,
  pids: readonly number[] | null,
): Promise<ProcessInfo[]> {
  if (pids !== null && pids.length === 0) return [];
  const args = pids === null ? ["-A", ...RUN_AS] : [...RUN_AS, "-p", pids.join(",")];
  return parseProcesses(await host.exec("ps", args));
}

/** Each PID's bb variables; null for a process whose environment is unreadable. */
export async function readVariables(
  host: ProcessHost,
  processes: readonly ProcessInfo[],
): Promise<Map<number, BbVariables | null>> {
  if (processes.length === 0) return new Map();
  if (host.platform === "linux") {
    const found = new Map<number, BbVariables | null>();
    for (const process of processes) {
      try {
        found.set(
          process.pid,
          bbVariables((await host.readFile(`/proc/${process.pid}/environ`)).split("\0")),
        );
      } catch {
        found.set(process.pid, null);
      }
    }
    return found;
  }
  const output = await host.exec("ps", [
    "eww",
    "-o",
    "pid=,command=",
    "-p",
    processes.map((process) => process.pid).join(","),
  ]);
  return parseEnvironments(output, new Map(processes.map((p) => [p.pid, p.command])));
}

/** Working folder and log file of each PID. */
export async function readFiles(
  host: ProcessHost,
  pids: readonly number[],
): Promise<Map<number, { cwd: string | null; log: string | null }>> {
  if (pids.length === 0) return new Map();
  return parseFiles(
    await host.exec("lsof", ["-a", "-p", pids.join(","), "-d", "cwd,1", "-F", "ftn"]),
  );
}

/**
 * SVC-2, SVC-12, SVC-20, SVC-22: every process listening on a TCP port, with
 * what it carries, except bb's own.
 */
export async function scanListeners(host: ProcessHost): Promise<ListenerScan> {
  if (host.platform !== "darwin" && host.platform !== "linux") return { available: false };
  let output: string;
  try {
    output = await host.exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]);
  } catch (error) {
    if (error instanceof CommandMissing) return { available: false };
    throw error;
  }
  const ports = parseListeners(output);
  if (ports.size === 0) return { available: true, listeners: [] };
  // Every process: SVC-22 needs the server's ancestors and their groups.
  const all = await listProcesses(host, null);
  const bbs = protectedPids(all, host.selfPid, host.bbExecutable);
  const processes = all.filter((p) => ports.has(p.pid) && !bbs.has(p.pid));
  const pids = processes.map((process) => process.pid);
  const [files, variables] = await Promise.all([
    readFiles(host, pids),
    readVariables(host, processes),
  ]);
  return {
    available: true,
    listeners: processes.map((process) => ({
      ...process,
      ports: [...(ports.get(process.pid) ?? [])].sort((a, b) => a - b),
      cwd: files.get(process.pid)?.cwd ?? null,
      logPath: files.get(process.pid)?.log ?? null,
      variables: variables.get(process.pid) ?? null,
    })),
  };
}
