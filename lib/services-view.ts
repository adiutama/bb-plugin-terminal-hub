// What the Services page shows of the server's list: the find field's rows
// (SVC-15), how a row is told apart across refreshes (SVC-8), sets (SVC-25),
// and how a record's URLs are shown (SVC-29).
import { findWords } from "./rail";
import type { Service, ServiceGroup, ServiceSet } from "./services-contract";

export { findWords };

/** A process's identity: its PID with its start time. */
export function serviceKey(service: Pick<Service, "pid" | "startedAt">): string {
  return `${service.pid}:${service.startedAt}`;
}

/** SVC-15: the listed processes, across every environment. */
export function serviceCount(groups: readonly ServiceGroup[]): number {
  return groups.reduce((sum, group) => sum + group.services.length, 0);
}

/**
 * SVC-15: rows where every word appears, ignoring case, in a port, the
 * command line, the PID, the service's name, its set's title or case, the
 * environment's name, or the project's name. Groups left with no row are
 * hidden.
 */
export function filterGroups(
  groups: readonly ServiceGroup[],
  words: readonly string[],
): ServiceGroup[] {
  if (words.length === 0) return [...groups];
  return groups.flatMap((group) => {
    const services = group.services.filter((service) => {
      const haystack = [
        ...service.ports.map((port) => `:${port}`),
        service.command,
        String(service.pid),
        service.name ?? "",
        service.set?.title ?? "",
        service.set?.case ?? "",
        group.environmentName,
        group.projectName,
      ]
        .join("\n")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
    return services.length > 0 ? [{ ...group, services }] : [];
  });
}

/**
 * SVC-24: the file name of the command line's first word: `node` for
 * `/Users/me/.local/share/mise/installs/node/22.23.2/bin/node --require …`.
 */
export function programName(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? "";
  return first.split("/").filter(Boolean).pop() ?? first;
}

/** SVC-25: a run of rows in one set (or in none), in the list's order. */
export interface SetRun {
  set: ServiceSet | null;
  services: Service[];
}

/** SVC-25: an environment's rows split into its sets and the unlabelled rest, kept in order. */
export function setRuns(services: readonly Service[]): SetRun[] {
  const runs: SetRun[] = [];
  for (const service of services) {
    const last = runs.at(-1);
    if (last && (last.set?.record ?? null) === (service.set?.record ?? null)) {
      last.services.push(service);
    } else {
      runs.push({ set: service.set, services: [service] });
    }
  }
  return runs;
}

/**
 * SVC-25: what a set row says: the record's title when it is readable, else
 * the name of the folder holding the record.
 */
export function setLabel(set: ServiceSet): string {
  if (set.title) return set.title;
  const parts = set.record.split("/").filter(Boolean);
  return parts.length >= 2 ? (parts.at(-2) ?? set.record) : set.record;
}

/** SVC-29: how a secret is shown until Show is pressed. */
export const MASK = "••••";

/** The password in a URL's user info, as positions in the string; null without one. */
function passwordSpan(url: string): { start: number; end: number } | null {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url);
  if (!scheme) return null;
  const from = scheme[0].length;
  const rest = url.slice(from);
  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  const at = authority.lastIndexOf("@");
  if (at === -1) return null;
  const colon = authority.slice(0, at).indexOf(":");
  if (colon === -1 || colon + 1 === at) return null;
  return { start: from + colon + 1, end: from + at };
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** SVC-29: the URL with the password in its user info shown as `••••`. */
export function maskUrl(url: string): string {
  const span = passwordSpan(url);
  if (span) return `${url.slice(0, span.start)}${MASK}${url.slice(span.end)}`;
  // Parsed with a password the plain reading missed: show none of it.
  return parse(url)?.password ? MASK : url;
}

/** SVC-29: whether the URL carries a password to mask. */
export function hasPassword(url: string): boolean {
  return passwordSpan(url) !== null || Boolean(parse(url)?.password);
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * SVC-29: where a URL links to, or null when it is copy-only: only `http` and
 * `https` on `127.0.0.1`, `localhost` or `::1`. While its password is
 * masked, the link carries none, so hovering it does not show it.
 */
export function localLink(url: string, revealed: boolean): string | null {
  const parsed = parse(url);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return null;
  if (!LOCAL_HOSTS.has(parsed.hostname)) return null;
  if (!revealed) parsed.password = "";
  return parsed.href;
}
