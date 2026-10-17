// The real ProcessHost: `lsof` and `ps` through execFile (argument arrays, no
// shell), files through node:fs, signals through process.kill. Only the
// server entry uses it; tests use recorded output instead.
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, open, readFile } from "node:fs/promises";
import { basename, delimiter, join } from "node:path";
import { CommandMissing, type ProcessHost } from "./processes";

/** bb started from the Dock may lack the system folders on its PATH. */
const SYSTEM_DIRS = ["/usr/sbin", "/usr/bin", "/sbin", "/bin"];
const EXEC_TIMEOUT_MS = 10_000;
const EXEC_MAX_BUFFER = 32 * 1024 * 1024;

const resolved = new Map<string, Promise<string | null>>();

/** The command's absolute path on PATH or in the system folders; null when absent. */
function resolveCommand(command: string): Promise<string | null> {
  let found = resolved.get(command);
  if (!found) {
    const dirs = [...(process.env.PATH ?? "").split(delimiter).filter(Boolean), ...SYSTEM_DIRS];
    found = (async () => {
      for (const dir of dirs) {
        const path = join(dir, command);
        try {
          await access(path, constants.X_OK);
          return path;
        } catch {
          // Not here.
        }
      }
      return null;
    })();
    resolved.set(command, found);
  }
  return found;
}

/** Runtimes that run any script: their path does not single out bb. */
const GENERIC_RUNTIMES = new Set(["node", "nodejs", "bun", "deno"]);

/**
 * SVC-22: bb's executable is the one running this server: bb ships its server
 * on its own binary (`/Applications/bb.app/Contents/MacOS/bb` on macOS, as
 * `ps` shows for bb's server, host daemon, and provider bridges). When the
 * server runs on a plain JavaScript runtime (a development setup), there is no
 * executable to match by, and only the ancestry rule applies.
 */
export function bbExecutableOf(execPath: string): string | null {
  const name = basename(execPath)
    .toLowerCase()
    .replace(/\.exe$/, "");
  return GENERIC_RUNTIMES.has(name) || /^node\d*$/.test(name) ? null : execPath;
}

export function nodeProcessHost(): ProcessHost {
  return {
    platform: process.platform,
    selfPid: process.pid,
    bbExecutable: bbExecutableOf(process.execPath),
    async exec(command, args) {
      const path = await resolveCommand(command);
      if (path === null) throw new CommandMissing(command);
      return new Promise((resolve, reject) => {
        execFile(
          path,
          [...args],
          {
            encoding: "utf8",
            timeout: EXEC_TIMEOUT_MS,
            maxBuffer: EXEC_MAX_BUFFER,
            // Fixed `lstart` format and plain output.
            env: { ...process.env, LC_ALL: "C" },
          },
          (error, stdout) => {
            if (error && (error as { code?: unknown }).code === "ENOENT") {
              reject(new CommandMissing(command));
            } else if (error && typeof (error as { code?: unknown }).code !== "number") {
              reject(error);
            } else {
              // A non-zero exit still has output: `lsof` exits 1 when it finds nothing.
              resolve(stdout);
            }
          },
        );
      });
    },
    readFile: (path) => readFile(path, "utf8"),
    async readTail(path, bytes) {
      const handle = await open(path, "r");
      try {
        const { size } = await handle.stat();
        const start = Math.max(0, size - bytes);
        const buffer = Buffer.alloc(size - start);
        await handle.read(buffer, 0, buffer.length, start);
        return { text: buffer.toString("utf8"), truncated: start > 0 };
      } finally {
        await handle.close();
      }
    },
    kill(target, signal) {
      process.kill(target, signal);
    },
  };
}
