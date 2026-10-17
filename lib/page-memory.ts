// Where the user was on the Terminals page, until bb reloads: the environment
// it last showed (NAV-4), each environment's last tab (LIST-36), folded
// projects (LIST-35), the rail's scroll position (LIST-29), and the find
// text (LIST-43).

/** LIST-29: the environment at the top of the rail, and how far below the top it sat. */
export interface ScrollAnchor {
  environmentId: string;
  /** The item's top minus the rail's top, in pixels; negative when cut off. */
  offset: number;
}

export class PageMemory {
  /** NAV-4: the environment the page last showed. */
  lastEnvironment: string | null = null;
  /** LIST-36: environment id → the tab it last showed. */
  readonly tabs = new Map<string, string>();
  /** LIST-35: folded projects. */
  folded: ReadonlySet<string> = new Set();
  scroll: ScrollAnchor | null = null;
  /** LIST-43: the rail's find text. */
  find = "";
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

const ITEM = "[data-environment-id]";

/**
 * LIST-29: the first rail item whose bottom is below the top of `scroller`,
 * and its offset from that top. Items carry `data-environment-id`.
 */
export function readScrollAnchor(scroller: HTMLElement): ScrollAnchor | null {
  const top = scroller.getBoundingClientRect().top;
  for (const item of scroller.querySelectorAll<HTMLElement>(ITEM)) {
    const box = item.getBoundingClientRect();
    if (box.bottom > top) {
      const environmentId = item.dataset.environmentId;
      if (environmentId) return { environmentId, offset: box.top - top };
    }
  }
  return null;
}

/**
 * LIST-29: scrolls so the anchor item sits where it was. False when the item
 * is not rendered.
 */
export function applyScrollAnchor(scroller: HTMLElement, anchor: ScrollAnchor): boolean {
  const item = [...scroller.querySelectorAll<HTMLElement>(ITEM)].find(
    (candidate) => candidate.dataset.environmentId === anchor.environmentId,
  );
  if (!item) return false;
  const delta = item.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop += delta - anchor.offset;
  return true;
}
