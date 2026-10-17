// A pretend machine for the Services tests: processes with their ports,
// folders, output, and environment variables, answered in the formats `lsof`
// and `ps` print (as recorded in docs/findings/2026-10-17-*). Signals are
// recorded and played on the pretend processes; nothing real is touched.
import { CommandMissing, type ProcessHost } from "../../lib/processes";

export interface FakeProcess {
  pid: number;
  pgid?: number;
  /** `ps -o lstart` as LC_ALL=C prints it. */
  start?: string;
  command: string;
  cwd?: string;
  /** Standard output: a regular file, or something else (a TTY, /dev/null). */
  stdout?: { type: "REG" | "CHR" | "FIFO"; path: string };
  /** Environment variables; null when the process's environment cannot be read. */
  env?: Record<string, string> | null;
  /** TCP ports it listens on. */
  ports?: number[];
  /** Keeps running after SIGTERM (SIGKILL always ends it). */
  ignoresTerm?: boolean;
}

export interface Machine {
  platform?: string;
  /** False: `lsof` is not installed. */
  lsof?: boolean;
  selfPid?: number;
  processes: FakeProcess[];
  /** File contents by path, for log tails. */
  files: Record<string, string>;
}

export const START = "Sat Oct 17 20:16:31 2026";
export const STARTED_AT = Date.parse(START);

export function machine(processes: FakeProcess[], files: Record<string, string> = {}): Machine {
  return { processes, files, selfPid: 99_999 };
}

/** The `-p` argument's PIDs; null when every process is asked for. */
function pidsOf(args: readonly string[]): Set<number> | null {
  const index = args.indexOf("-p");
  if (index === -1) return null;
  return new Set((args[index + 1] ?? "").split(",").map(Number));
}

const shortName = (command: string) => command.split(" ")[0]?.split("/").pop() ?? "";

export function fakeHost(m: Machine) {
  const kills: { target: number; signal: string }[] = [];
  const calls: { command: string; args: string[] }[] = [];
  const asked = (args: readonly string[]) => {
    const pids = pidsOf(args);
    return m.processes.filter((p) => pids === null || pids.has(p.pid));
  };
  const host: ProcessHost = {
    platform: m.platform ?? "darwin",
    selfPid: m.selfPid ?? 99_999,
    async exec(command, args) {
      calls.push({ command, args: [...args] });
      if (command === "lsof") {
        if (m.lsof === false) throw new CommandMissing("lsof");
        if (args.includes("-iTCP")) {
          const lines: string[] = [];
          for (const p of m.processes) {
            if (!p.ports?.length) continue;
            lines.push(`p${p.pid}`, `c${shortName(p.command)}`);
            p.ports.forEach((port, index) => {
              // IPv4 and IPv6 sockets for the same port, as lsof lists them.
              lines.push(`f${20 + index}`, `n*:${port}`, `f${40 + index}`, `n[::1]:${port}`);
            });
          }
          return lines.length ? `${lines.join("\n")}\n` : "";
        }
        const lines: string[] = [];
        for (const p of asked(args)) {
          lines.push(`p${p.pid}`);
          if (p.cwd) lines.push("fcwd", "tDIR", `n${p.cwd}`);
          if (p.stdout) lines.push("f1", `t${p.stdout.type}`, `n${p.stdout.path}`);
        }
        return lines.length ? `${lines.join("\n")}\n` : "";
      }
      if (args[0] === "eww") {
        return asked(args)
          .map((p) => {
            const env = p.env === null ? "" : envPairs(p.env ?? {});
            return `${String(p.pid).padStart(5)} ${p.command}${env ? ` ${env}` : ""}`;
          })
          .join("\n");
      }
      return asked(args)
        .map(
          (p) =>
            `${String(p.pid).padStart(5)} ${String(p.pgid ?? p.pid).padStart(5)} ${p.start ?? START}     ${p.command}`,
        )
        .join("\n");
    },
    async readFile(path) {
      const match = /^\/proc\/(\d+)\/environ$/.exec(path);
      const p = m.processes.find((proc) => proc.pid === Number(match?.[1]));
      if (!p) throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      if (p.env === null) throw Object.assign(new Error(`EACCES: ${path}`), { code: "EACCES" });
      return `${Object.entries(p.env ?? { HOME: "/Users/me" })
        .map(([key, value]) => `${key}=${value}`)
        .join("\0")}\0`;
    },
    async readTail(path, bytes) {
      const text = m.files[path];
      if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      const data = Buffer.from(text);
      const start = Math.max(0, data.length - bytes);
      return { text: data.subarray(start).toString("utf8"), truncated: start > 0 };
    },
    kill(target, signal) {
      kills.push({ target, signal });
      const hit =
        target < 0
          ? m.processes.filter((p) => (p.pgid ?? p.pid) === -target)
          : m.processes.filter((p) => p.pid === target);
      if (hit.length === 0) throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
      m.processes = m.processes.filter(
        (p) => !hit.includes(p) || (signal === "SIGTERM" && p.ignoresTerm),
      );
    },
  };
  return { host, kills, calls };
}

function envPairs(env: Record<string, string>): string {
  const pairs = Object.entries({ HOME: "/Users/me", PATH: "/usr/bin:/bin", ...env });
  return pairs.map(([key, value]) => `${key}=${value}`).join(" ");
}

/** The variables an agent's shell passes to what it starts. */
export function agentEnv(environmentId: string, threadId: string): Record<string, string> {
  return {
    BB_ENVIRONMENT_ID: environmentId,
    BB_THREAD_ID: threadId,
    BB_PROJECT_ID: "proj_1",
  };
}
