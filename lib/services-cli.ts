// `bb terminal-hub services`: what the Services page lists for one
// environment, for agents (AGENT-7, AGENT-8).
import type { Service, ServicesList } from "./services-contract";
import { formatAgo } from "./time";

export interface EnvironmentServices {
  environmentId: string;
  available: boolean;
  /** SVC-11: false when the environment is on another host. */
  checked: boolean;
  /** `project › environment`, when bb lists the environment. */
  place: string | null;
  services: Service[];
}

export function servicesIn(list: ServicesList, environmentId: string): EnvironmentServices {
  const group = list.groups.find((g) => g.environmentId === environmentId);
  return {
    environmentId,
    available: list.available,
    checked: group?.checked ?? true,
    place: group ? `${group.projectName} › ${group.environmentName}` : null,
    services: group?.services ?? [],
  };
}

/** AGENT-7: each process with its ports, PID, command line, starting thread, and log path. */
export function formatServicesText(listing: EnvironmentServices, now: number): string {
  const heading = `Services in environment ${listing.environmentId}`;
  const out = [listing.place ? `${heading} (${listing.place})` : heading];
  if (!listing.available) {
    out.push("  Detection is unavailable on this machine: lsof was not found.");
  } else if (!listing.checked) {
    out.push("  Not checked: the environment is on another host.");
  } else if (listing.services.length === 0) {
    out.push("  (none running)");
  }
  for (const service of listing.services) {
    const ports = service.ports.map((port) => `:${port}`).join(" ");
    out.push(
      `  ${ports}  pid ${service.pid}  up ${formatAgo(service.startedAt, now)}  ${service.command}`,
    );
    if (service.threadId) {
      out.push(
        service.threadTitle === null
          ? `    started by thread ${service.threadId}`
          : `    started by thread "${service.threadTitle}" (${service.threadId})`,
      );
    }
    out.push(`    log ${service.logPath ?? "(none: standard output is not a file)"}`);
  }
  return `${out.join("\n")}\n`;
}

/** AGENT-8: machine-readable, one entry per process. */
export function servicesJson(listing: EnvironmentServices) {
  return {
    environmentId: listing.environmentId,
    available: listing.available,
    checked: listing.checked,
    services: listing.services.map((service) => ({
      pid: service.pid,
      ports: service.ports,
      command: service.command,
      startedAt: service.startedAt,
      threadId: service.threadId,
      logPath: service.logPath,
      environmentId: service.environmentId,
    })),
  };
}
