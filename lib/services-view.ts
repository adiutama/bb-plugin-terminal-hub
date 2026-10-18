// What the Services page shows of the server's list: the find field's rows
// (SVC-15) and how a row is told apart across refreshes (SVC-8).
import { findWords } from "./rail";
import type { Service, ServiceGroup } from "./services-contract";

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
 * command line, the PID, the environment's name, or the project's name.
 * Groups left with no row are hidden.
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
