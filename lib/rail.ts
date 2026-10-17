// What the rail lists, what "Find environment" leaves, and which environment
// the page selects on its own (NAV-4, LIST-37).
import type { HubSnapshot, ProjectRecord } from "./hub";
import type { EnvironmentInfo, Section } from "./hub-store";
import type { ServerHint } from "./server-hint";

export interface RailEnvironment {
  projectId: string;
  environment: EnvironmentInfo;
  section: Section;
}

export interface RailGroup {
  project: ProjectRecord;
  environments: RailEnvironment[];
  /** LIST-17: why the project, or one of its environments, failed to list. */
  error: string | null;
}

/** An environment, wherever it is listed. */
export interface Place {
  projectId: string;
  environmentId: string;
}

/**
 * LIST-33: bb's projects in bb's order, each with its environments that have
 * terminals, or hold the selected terminal (`held`). A project that lists no
 * environment is left out, unless it failed to list (LIST-17).
 */
export function railGroups(snapshot: HubSnapshot, held: Place | null): RailGroup[] {
  const groups: RailGroup[] = [];
  for (const project of snapshot.projects ?? []) {
    const view = snapshot.views.get(project.id);
    if (!view) continue;
    const environments = view.sections
      .filter(
        (section) =>
          section.rows.length > 0 ||
          (held?.projectId === project.id && held.environmentId === section.environment.id),
      )
      .map((section) => ({ projectId: project.id, environment: section.environment, section }));
    const error = view.error ?? view.sections.find((section) => section.error)?.error ?? null;
    if (environments.length === 0 && error === null) continue;
    groups.push({ project, environments, error });
  }
  return groups;
}

/** LIST-42: the words of the find text; empty or whitespace-only is no filter. */
export function findWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * LIST-42: every word appears in the environment's name, its project's name,
 * or one of its terminals' title, server hint label, or owning thread's title.
 */
export function environmentMatches(
  project: ProjectRecord,
  entry: RailEnvironment,
  words: readonly string[],
  hints: ReadonlyMap<string, ServerHint>,
): boolean {
  if (words.length === 0) return true;
  const haystack = [
    entry.environment.name,
    project.name,
    ...entry.section.rows.flatMap((row) => [
      row.terminal.title,
      hints.get(row.terminal.id)?.label ?? "",
      row.thread?.title ?? "",
    ]),
  ]
    .join("\n")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** LIST-42: the rail narrowed to matching environments; projects with none are left out. */
export function filterRail(
  groups: readonly RailGroup[],
  words: readonly string[],
  hintsFor: (projectId: string) => ReadonlyMap<string, ServerHint>,
): RailGroup[] {
  if (words.length === 0) return [...groups];
  return groups.flatMap((group) => {
    const hints = hintsFor(group.project.id);
    const environments = group.environments.filter((entry) =>
      environmentMatches(group.project, entry, words, hints),
    );
    return environments.length > 0 ? [{ ...group, environments }] : [];
  });
}

/** The rail's environments, top to bottom. */
export function railOrder(groups: readonly RailGroup[]): Place[] {
  return groups.flatMap((group) =>
    group.environments.map((entry) => ({
      projectId: entry.projectId,
      environmentId: entry.environment.id,
    })),
  );
}

/**
 * LIST-37: the selected environment left the rail. The next one listed below
 * it is selected, else the one above, else none. `before` is the rail as it
 * was while it still listed the environment.
 */
export function nextEnvironment(
  before: readonly Place[],
  now: readonly Place[],
  leaving: string,
): Place | null {
  const index = before.findIndex((place) => place.environmentId === leaving);
  if (index === -1) return null;
  const listed = (place: Place) => now.some((p) => p.environmentId === place.environmentId);
  for (let i = index + 1; i < before.length; i++) {
    const place = before[i];
    if (place && listed(place)) return place;
  }
  for (let i = index - 1; i >= 0; i--) {
    const place = before[i];
    if (place && listed(place)) return place;
  }
  return null;
}

export type Choice = { kind: "wait" } | { kind: "none" } | ({ kind: "place" } & Place);

/** The project that lists `environmentId`, if any project does. */
export function projectOf(snapshot: HubSnapshot, environmentId: string): string | null {
  for (const [projectId, view] of snapshot.views) {
    if (view.environments?.some((env) => env.id === environmentId)) return projectId;
  }
  return null;
}

/**
 * NAV-4: with no environment in the URL, the first of `candidates` (the
 * environment of the thread bb was showing, then the one the page last
 * showed) that the rail lists; else the first environment the rail lists.
 * Until the projects that decide it are listed, wait rather than choose.
 */
export function chooseEnvironment(
  snapshot: HubSnapshot,
  groups: readonly RailGroup[],
  candidates: readonly (string | null)[],
): Choice {
  if (snapshot.projects === null) return snapshot.projectsError ? { kind: "none" } : WAIT;
  const order = railOrder(groups);
  const allReady = [...snapshot.views.values()].every((view) => view.ready);
  for (const candidate of candidates) {
    if (candidate === null) continue;
    const listed = order.find((place) => place.environmentId === candidate);
    if (listed) return { kind: "place", ...listed };
    const projectId = projectOf(snapshot, candidate);
    const ready = projectId === null ? allReady : snapshot.views.get(projectId)?.ready;
    if (!ready) return WAIT;
  }
  for (const project of snapshot.projects) {
    const view = snapshot.views.get(project.id);
    if (!view?.ready) return WAIT;
    const first = order.find((place) => place.projectId === project.id);
    if (first) return { kind: "place", ...first };
  }
  return { kind: "none" };
}

const WAIT: Choice = { kind: "wait" };
