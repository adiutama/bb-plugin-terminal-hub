// What the list shows of the store's sections: which environments get a
// section, the order a selection moves through, and the summary line.
import { settledTargets } from "./actions";
import type { EnvironmentInfo, Section } from "./hub-store";
import { type HubRow, isRunning, orderedRows } from "./inventory";
import type { ServerHint } from "./server-hint";

function hasRows(section: Section): boolean {
  return section.grouped.environment.length > 0 || section.grouped.threads.length > 0;
}

/** The environment whose section lists `terminalId`, if any. */
export function environmentOf(
  sections: readonly Section[],
  terminalId: string | null,
): string | null {
  if (terminalId === null) return null;
  const section = sections.find((candidate) =>
    orderedRows(candidate.grouped).some((row) => row.terminal.id === terminalId),
  );
  return section?.environment.id ?? null;
}

/**
 * LIST-13: environments with terminals, a listing error, or the selected
 * terminal get a section; the rest are empty. Both keep BB's order.
 */
export function splitSections(
  sections: readonly Section[],
  selectedEnvironmentId: string | null,
): { shown: Section[]; empty: Section[] } {
  const shown: Section[] = [];
  const empty: Section[] = [];
  for (const section of sections) {
    const keep =
      hasRows(section) ||
      section.error !== null ||
      section.environment.id === selectedEnvironmentId;
    (keep ? shown : empty).push(section);
  }
  return { shown, empty };
}

/**
 * ACT-7: terminal ids in the order the list shows them. A collapsed section
 * contributes only the selected terminal, as an anchor to move on from.
 */
export function visibleOrder(
  shown: readonly Section[],
  collapsed: ReadonlySet<string>,
  selectedId: string | null,
): string[] {
  return shown.flatMap((section) => {
    const ids = orderedRows(section.grouped).map((row) => row.terminal.id);
    if (!collapsed.has(section.environment.id)) return ids;
    return ids.filter((id) => id === selectedId);
  });
}

export interface Summary {
  running: number;
  servers: number;
  stale: number;
}

/** LIST-16: running terminals, those serving a local address, and stale ones. */
export function summarize(
  rows: readonly HubRow[],
  hints: ReadonlyMap<string, ServerHint>,
): Summary {
  const running = rows.filter((row) => isRunning(row.terminal));
  return {
    running: running.length,
    servers: running.filter((row) => hints.has(row.terminal.id)).length,
    stale: settledTargets(rows).length,
  };
}

/** LIST-9: the menu's environments, `firstId` first, the rest in BB's order. */
export function menuEnvironments(
  environments: readonly EnvironmentInfo[],
  firstId: string | null,
): { first: EnvironmentInfo | null; rest: EnvironmentInfo[] } {
  const first = environments.find((env) => env.id === firstId) ?? null;
  return { first, rest: environments.filter((env) => env !== first) };
}
