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
  /** This server's own PID; its process group is never signalled. */
  selfPid: number;
  /**
   * Runs `command` with `args` (no shell) and resolves its standard output,
   * also when it exits non-zero (`lsof` does when it finds nothing). Rejects
   * with CommandMissing when the command is not installed.
   */
  exec(command: "lsof" | "ps", args: readonly string[]): Promise<string>;
  /** A whole small file, such as `/proc/<pid>/environ`. */
  readFile(path: string): Promise<string>;
  /** Up to the last `bytes` bytes of a file, and whether it holds more. */
  readTail(path: string, bytes: number): Promise<{ text: string; truncated: boolean }>;
  /** A signal to a PID, or to a process group when `target` is negative. */
  kill(target: number, signal: "SIGTERM" | "SIGKILL"): void;
}

/** A process as `ps` lists it. */
export interface ProcessInfo {
  pid: number;
  pgid: number;
  /** Start time in ms, to the second. */
  startedAt: number;
  command: string;
}

/** The bb variables a process started with; null when they cannot be read. */
export interface BbVariables {
  environmentId: string | null;
  threadId: string | null;
  terminalSessionId: string | null;
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

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{1,2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/;

/** `ps -o pid=,pgid=,lstart=,command=` output, run with `LC_ALL=C`. */
export function parseProcesses(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of output.split("\n")) {
    const match = PS_LINE.exec(line);
    if (!match) continue;
    const startedAt = Date.parse((match[3] ?? "").replace(/\s+/g, " "));
    if (Number.isNaN(startedAt)) continue;
    processes.push({
      pid: Number(match[1]),
      pgid: Number(match[2]),
      startedAt,
      command: (match[4] ?? "").trimEnd(),
    });
  }
  return processes;
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

/** The bb variables in `KEY=value` pairs; null when no pair was readable. */
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
  };
}

/**
 * macOS: `ps eww -o pid=,command=` prints each command followed by its
 * environment. The command is known from `ps`, so what follows it is the
 * environment; bb's ids hold no spaces.
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
    found.set(pid, bbVariables(tail.trim().split(/\s+/)));
  }
  return found;
}

const RUN_AS = ["-ww", "-o", "pid=,pgid=,lstart=,command="];

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

/** SVC-2, SVC-12, SVC-20: every process listening on a TCP port, with what it carries. */
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
  const processes = await listProcesses(host, [...ports.keys()]);
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
