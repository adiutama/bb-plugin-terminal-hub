// What the list shows of the store's sections: which environments get a
// section, what the filter leaves, the order a selection moves through, and
// the summary line.
import { settledTargets } from "./actions";
import type { EnvironmentInfo, Section } from "./hub-store";
import { type HubRow, isRunning, orderedRows } from "./inventory";
import { shortenHome } from "./paths";
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

/** LIST-18: the filter's words, lowercased; none for empty or blank text. */
export function filterWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

/** LIST-18: every word appears in at least one of the fields. */
export function matchesWords(
  fields: readonly (string | null | undefined)[],
  words: readonly string[],
): boolean {
  const haystack = fields.flatMap((field) => (field ? [field.toLowerCase()] : []));
  return words.every((word) => haystack.some((field) => field.includes(word)));
}

export interface FilterContext {
  words: readonly string[];
  hints: ReadonlyMap<string, ServerHint>;
  homes: ReadonlyMap<string, string | null>;
}

/**
 * LIST-18: title, environment name, thread title, starting directory (as
 * shown and in full), and server hint label and address.
 */
export function rowMatches(row: HubRow, environmentName: string, context: FilterContext): boolean {
  const { terminal } = row;
  const hint = context.hints.get(terminal.id);
  const home = context.homes.get(terminal.hostId) ?? null;
  return matchesWords(
    [
      terminal.title || "Terminal",
      environmentName,
      row.thread?.title,
      terminal.initialCwd,
      shortenHome(terminal.initialCwd, home),
      hint?.label,
      hint?.url,
    ],
    context.words,
  );
}

/** LIST-18: the section with only its matching rows; empty thread groups go. */
export function filterSection(section: Section, context: FilterContext): Section {
  const keep = (row: HubRow) => rowMatches(row, section.environment.name, context);
  return {
    ...section,
    grouped: {
      environment: section.grouped.environment.filter(keep),
      threads: section.grouped.threads
        .map((group) => ({ ...group, rows: group.rows.filter(keep) }))
        .filter((group) => group.rows.length > 0),
    },
  };
}

/**
 * LIST-19: with a filter, the All view shows sections with matching rows or
 * a listing error, and, once complete, the empty environments whose name
 * matches. Both keep BB's order.
 */
export function filterAll(
  sections: readonly Section[],
  context: FilterContext,
  complete: boolean,
): { shown: Section[]; emptyMatches: Section[] } {
  const shown: Section[] = [];
  const emptyMatches: Section[] = [];
  for (const section of sections) {
    const filtered = filterSection(section, context);
    if (hasRows(filtered) || section.error !== null) shown.push(filtered);
    else if (
      complete &&
      !hasRows(section) &&
      matchesWords([section.environment.name], context.words)
    ) {
      emptyMatches.push(section);
    }
  }
  return { shown, emptyMatches };
}

/**
 * ACT-7 with a filter: the ids `visible` keeps, in list order, with the
 * selected terminal kept as an anchor to move on from.
 */
export function filteredOrder(
  sections: readonly Section[],
  visible: readonly Section[],
  selectedId: string | null,
): string[] {
  const ids = new Set(
    visible.flatMap((section) => orderedRows(section.grouped)).map((row) => row.terminal.id),
  );
  return sections.flatMap((section) =>
    orderedRows(section.grouped)
      .map((row) => row.terminal.id)
      .filter((id) => id === selectedId || ids.has(id)),
  );
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
