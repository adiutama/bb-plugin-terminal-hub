// Where the user was on the Terminals page, per project, until bb reloads
// (ADR 202610111227): the route (NAV-10), collapsed sections (LIST-13), the
// list's scroll position (LIST-29), and the filter (LIST-21).

/** LIST-29: the row at the top of the list, and how far below the top it sat. */
export interface ScrollAnchor {
  terminalId: string;
  /** The row's top minus the list's top, in pixels; negative when cut off. */
  offset: number;
}

export interface ProjectMemory {
  /** NAV-10: the environment (or `all`) and terminal last shown. */
  route: { environment: string; terminalId: string | null } | null;
  collapsed: ReadonlySet<string>;
  scroll: ScrollAnchor | null;
}

export class PageMemory {
  private projects = new Map<string, ProjectMemory>();
  /** NAV-4: the project the page last showed. */
  lastProjectId: string | null = null;
  /** LIST-21: one filter, for the project it was typed in. */
  filter: { projectId: string; text: string } | null = null;

  project(projectId: string): ProjectMemory {
    let memory = this.projects.get(projectId);
    if (!memory) {
      memory = { route: null, collapsed: new Set(), scroll: null };
      this.projects.set(projectId, memory);
    }
    return memory;
  }

  /** The filter typed in `projectId`, or empty for any other project. */
  filterFor(projectId: string): string {
    return this.filter?.projectId === projectId ? this.filter.text : "";
  }
}

const memories = new WeakMap<object, PageMemory>();

/** The page's memory; keyed by `useSdk()`, which is stable for the plugin's lifetime. */
export function pageMemoryFor(sdk: object): PageMemory {
  let memory = memories.get(sdk);
  if (!memory) {
    memory = new PageMemory();
    memories.set(sdk, memory);
  }
  return memory;
}

/**
 * LIST-29: the first row whose bottom is below the top of `scroller`, and its
 * offset from that top. Rows carry `data-terminal-id`.
 */
export function readScrollAnchor(scroller: HTMLElement): ScrollAnchor | null {
  const top = scroller.getBoundingClientRect().top;
  for (const row of scroller.querySelectorAll<HTMLElement>("[data-terminal-id]")) {
    const box = row.getBoundingClientRect();
    if (box.bottom > top) {
      const terminalId = row.dataset.terminalId;
      if (terminalId) return { terminalId, offset: box.top - top };
    }
  }
  return null;
}

/**
 * LIST-29: scrolls so the anchor row sits where it was. False when the row
 * is not rendered.
 */
export function applyScrollAnchor(scroller: HTMLElement, anchor: ScrollAnchor): boolean {
  const row = [...scroller.querySelectorAll<HTMLElement>("[data-terminal-id]")].find(
    (candidate) => candidate.dataset.terminalId === anchor.terminalId,
  );
  if (!row) return false;
  const delta = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop += delta - anchor.offset;
  return true;
}
