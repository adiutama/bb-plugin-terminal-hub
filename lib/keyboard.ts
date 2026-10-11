import type { KeyboardEvent } from "react";

/** Explicit cycling also works when macOS skips selects during native Tab navigation. */
export function containTab(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab" || event.defaultPrevented) return;
  const root = event.currentTarget;
  // A portaled menu has its own focus management.
  if (!(event.target instanceof Node) || !root.contains(event.target)) return;
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), [tabindex]',
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 && !element.closest('[inert], [hidden], [aria-hidden="true"]'),
  );
  event.preventDefault();
  const index = elements.indexOf(document.activeElement as HTMLElement);
  const next =
    index === -1
      ? event.shiftKey
        ? elements.length - 1
        : 0
      : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
  (elements[next] ?? root).focus();
}

/** Runs after the shell/control has handled the key, before BB's bubbling shortcuts. */
export function isolateTerminalKey(event: KeyboardEvent<HTMLElement>): void {
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
  if (event.type !== "keydown" || event.defaultPrevented || event.nativeEvent.isComposing) return;
  containTab(event);
  const key = event.key.toLowerCase();
  // Preserve browser editing/clipboard defaults. Shell control codes and terminal
  // shortcuts have already been handled at the target by Ghostty's input layer.
  const editing = [
    "a",
    "c",
    "v",
    "x",
    "z",
    "y",
    "arrowleft",
    "arrowright",
    "arrowup",
    "arrowdown",
    "backspace",
    "delete",
    "home",
    "end",
  ];
  const command = (event.metaKey || event.ctrlKey) && !event.altKey;
  if (
    (command && !editing.includes(key)) ||
    /^f\d{1,2}$/.test(key) ||
    (event.altKey && !event.ctrlKey && ["arrowleft", "arrowright"].includes(key))
  ) {
    event.preventDefault();
  }
}

/** The parts of a key event the list's keyboard handling reads. */
interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
  nativeEvent?: { isComposing?: boolean };
}

/** Where `/` means a character, or a menu or dialog owns the keys. */
const KEEPS_SLASH =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .th-terminal, [role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]';

/**
 * LIST-22: `/` focuses the filter. The caller listens on the page, so focus
 * is already inside it; this rules out text fields, the terminal view,
 * menus, dialogs, modifiers, and input method composition.
 */
export function isFilterShortcut(event: KeyLike): boolean {
  if (event.key !== "/" || event.defaultPrevented) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent?.isComposing) {
    return false;
  }
  const target = event.target;
  return !(target instanceof Element && target.closest(KEEPS_SLASH));
}

/** LIST-23: the list's keyboard order, top to bottom. */
export function navItems(root: ParentNode | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>("[data-nav-item]")) : [];
}

/**
 * LIST-23: ↑/↓, Home and End move focus between the list's items, without
 * wrapping; ↑ from the first calls `onTop`. Only keys on an item itself
 * count, so a row's dismiss and ⋯ buttons, and its open menu, keep theirs.
 */
export function moveInList(
  event: KeyboardEvent<HTMLElement>,
  root: HTMLElement | null,
  onTop: () => void,
): void {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.hasAttribute("data-nav-item")) return;
  const items = navItems(root);
  const index = items.indexOf(target);
  if (index === -1) return;
  let next: HTMLElement | undefined;
  if (event.key === "ArrowDown") next = items[index + 1] ?? target;
  else if (event.key === "ArrowUp") {
    if (index === 0) {
      event.preventDefault();
      onTop();
      return;
    }
    next = items[index - 1];
  } else if (event.key === "Home") next = items[0];
  else if (event.key === "End") next = items.at(-1);
  else return;
  event.preventDefault();
  next?.focus();
}
