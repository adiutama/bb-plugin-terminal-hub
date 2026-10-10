// `bb terminal-hub list`: the session list for one environment, for agents.
//
// Built from the same inventory and grouping as the page (AGENT-3), so an
// agent sees what the user sees before starting another server.
import {
  type GroupedEnvironment,
  groupEnvironment,
  type HubRow,
  type InventorySdk,
  isRunning,
  loadEnvironment,
  mapLimited,
  orderedRows,
  SCAN_CONCURRENCY,
} from "./inventory";
import { shortenHome } from "./paths";
import { findServerHint, HINT_TAIL_BYTES, type ServerHint } from "./server-hint";
import { base64ToBytes } from "./terminal-io";
import { formatAgo } from "./time";

export interface CliSdk extends InventorySdk {
  terminals: InventorySdk["terminals"] & {
    output(args: {
      terminalId: string;
      tailBytes?: number;
    }): Promise<{ chunks: { dataBase64: string }[] }>;
  };
  threads: InventorySdk["threads"] & {
    get(args: { threadId: string }): Promise<{ environmentId: string | null }>;
  };
  hosts: { directory(args: { hostId: string }): Promise<{ directory: string }> };
}

export interface Listing {
  environmentId: string;
  grouped: GroupedEnvironment;
  hints: Map<string, ServerHint>;
  homes: Map<string, string | null>;
}

/** AGENT-4: `--environment`, else the calling thread's environment. */
export async function resolveEnvironment(
  sdk: CliSdk,
  flag: string | undefined,
  threadId: string | undefined,
): Promise<string | null> {
  if (flag) return flag;
  if (!threadId) return null;
  const thread = await sdk.threads.get({ threadId });
  return thread.environmentId;
}

export async function listEnvironment(sdk: CliSdk, environmentId: string): Promise<Listing> {
  const grouped = groupEnvironment(await loadEnvironment(sdk, environmentId));
  const rows = orderedRows(grouped);
  const hints = new Map<string, ServerHint>();
  await mapLimited(
    rows.filter((row) => isRunning(row.terminal)),
    SCAN_CONCURRENCY,
    async (row) => {
      try {
        const output = await sdk.terminals.output({
          terminalId: row.terminal.id,
          tailBytes: HINT_TAIL_BYTES,
        });
        const bytes = output.chunks.map((chunk) => base64ToBytes(chunk.dataBase64));
        const text = new TextDecoder().decode(concat(bytes));
        const hint = findServerHint(text);
        if (hint) hints.set(row.terminal.id, hint);
      } catch {
        // No output, no hint.
      }
    },
  );
  const homes = new Map<string, string | null>();
  for (const hostId of new Set(rows.map((row) => row.terminal.hostId))) {
    try {
      homes.set(hostId, (await sdk.hosts.directory({ hostId })).directory);
    } catch {
      homes.set(hostId, null);
    }
  }
  return { environmentId, grouped, hints, homes };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function status(row: HubRow): string {
  if (isRunning(row.terminal)) return "running";
  return row.terminal.exitCode === null ? "exited" : `exited ${row.terminal.exitCode}`;
}

function line(row: HubRow, listing: Listing, now: number): string {
  const { terminal, thread } = row;
  const parts = [
    `${isRunning(terminal) ? "●" : "○"} ${terminal.title || "Terminal"}`,
    terminal.id,
    status(row),
    shortenHome(terminal.initialCwd, listing.homes.get(terminal.hostId) ?? null),
  ];
  const hint = listing.hints.get(terminal.id);
  if (hint) parts.push(hint.url);
  if (thread) {
    parts.push(`thread "${thread.title}" (${thread.id}) ${thread.state}`);
    if (row.stale && thread.inactiveSince !== null) {
      parts.push(`stale: thread ${thread.state} ${formatAgo(thread.inactiveSince, now)}`);
    }
  }
  return `  ${parts.join("  ")}`;
}

/** AGENT-3: grouped like the page, with each thread terminal's thread and state. */
export function formatText(listing: Listing, now: number): string {
  const { environment, threads } = listing.grouped;
  const out = [`Terminals in environment ${listing.environmentId}`];
  if (environment.length === 0 && threads.length === 0) {
    out.push("  (none running)");
    return `${out.join("\n")}\n`;
  }
  out.push("Environment");
  if (environment.length === 0) out.push("  (none)");
  for (const row of environment) out.push(line(row, listing, now));
  out.push("From threads");
  if (threads.length === 0) out.push("  (none)");
  for (const group of threads) for (const row of group.rows) out.push(line(row, listing, now));
  return `${out.join("\n")}\n`;
}

/** AGENT-5: one entry per terminal, in list order. */
export function toJson(listing: Listing) {
  return {
    environmentId: listing.environmentId,
    terminals: orderedRows(listing.grouped).map((row) => ({
      id: row.terminal.id,
      title: row.terminal.title,
      status: row.terminal.status,
      exitCode: row.terminal.exitCode,
      scope: row.thread ? ("thread" as const) : ("environment" as const),
      cwd: row.terminal.initialCwd,
      serverHint: listing.hints.get(row.terminal.id)?.url ?? null,
      thread: row.thread
        ? {
            id: row.thread.id,
            title: row.thread.title,
            state: row.thread.state,
            stale: row.stale,
            inactiveSince: row.thread.inactiveSince,
          }
        : null,
    })),
  };
}
