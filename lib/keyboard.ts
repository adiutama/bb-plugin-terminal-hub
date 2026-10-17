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

/** The parts of a key event the page's `/` shortcut reads. */
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
 * LIST-44: `/` focuses the rail's find field. The caller listens on the page,
 * so focus is already inside it; this rules out text fields, the terminal
 * view, menus, dialogs, modifiers, and input method composition.
 */
export function isFindShortcut(event: KeyLike): boolean {
  if (event.key !== "/" || event.defaultPrevented) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent?.isComposing) {
    return false;
  }
  const target = event.target;
  return !(target instanceof Element && target.closest(KEEPS_SLASH));
}

/** LIST-47: the page's own shortcuts. */
export type PageShortcut = "new" | "close" | "find";

const SHORTCUTS: Record<string, PageShortcut> = { t: "new", w: "close", p: "find" };

/** Where a dialog or a menu owns the keys (LIST-47). */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function isMac(): boolean {
  const nav = typeof navigator === "undefined" ? null : navigator;
  return /Mac|iPhone|iPad|iPod/.test(nav?.platform || nav?.userAgent || "");
}

/**
 * LIST-47: Mod+T, Mod+W or Mod+P while focus is in the page (`root`), the
 * terminal view included, or nowhere, and no dialog or menu is open. `Mod` is
 * Cmd on macOS and Ctrl elsewhere; no other modifier may be held.
 */
export function pageShortcut(
  event: Pick<
    globalThis.KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing" | "defaultPrevented"
  >,
  root: HTMLElement | null,
  mac: boolean = isMac(),
): PageShortcut | null {
  if (root === null || event.isComposing || event.altKey || event.shiftKey) return null;
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod) return null;
  const shortcut = SHORTCUTS[event.key.toLowerCase()];
  if (!shortcut) return null;
  const active = document.activeElement;
  if (active && active !== document.body && !root.contains(active)) return null;
  if (document.querySelector(OVERLAY)) return null;
  return shortcut;
}
