// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isFindShortcut, pageShortcut } from "../lib/keyboard";

function slash(target: Element, extra: Partial<Parameters<typeof isFindShortcut>[0]> = {}) {
  return isFindShortcut({
    key: "/",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    target,
    nativeEvent: { isComposing: false },
    ...extra,
  });
}

function html(markup: string, selector: string): Element {
  document.body.innerHTML = markup;
  const element = document.querySelector(selector);
  if (!element) throw new Error(`no ${selector}`);
  return element;
}

describe("find shortcut", () => {
  it("LIST-44: `/` on an environment or other button focuses the find field", () => {
    expect(slash(html("<ul><li><button>dev</button></li></ul>", "button"))).toBe(true);
  });

  it("LIST-44: `/` in a text field, the terminal view, a menu, or a dialog is left alone", () => {
    expect(slash(html("<input>", "input"))).toBe(false);
    expect(slash(html("<textarea></textarea>", "textarea"))).toBe(false);
    expect(slash(html('<div contenteditable="true"><p>x</p></div>', "p"))).toBe(false);
    expect(
      slash(html('<div class="th-terminal"><div tabindex="0">t</div></div>', "[tabindex]")),
    ).toBe(false);
    expect(
      slash(html('<div role="menu"><div role="menuitem">Rename</div></div>', '[role="menuitem"]')),
    ).toBe(false);
    expect(slash(html('<div role="dialog"><button>OK</button></div>', "button"))).toBe(false);
    expect(
      slash(html('<div role="listbox"><div role="option">x</div></div>', '[role="option"]')),
    ).toBe(false);
  });

  it("LIST-44: modifiers, composition, other keys, and handled events do not count", () => {
    const button = html("<button>dev</button>", "button");
    expect(slash(button, { metaKey: true })).toBe(false);
    expect(slash(button, { ctrlKey: true })).toBe(false);
    expect(slash(button, { altKey: true })).toBe(false);
    expect(slash(button, { nativeEvent: { isComposing: true } })).toBe(false);
    expect(slash(button, { defaultPrevented: true })).toBe(false);
    expect(slash(button, { key: "?" })).toBe(false);
  });
});

describe("page shortcuts", () => {
  const press = (init: Partial<KeyboardEvent> & { key: string }) => ({
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    defaultPrevented: false,
    ...init,
  });

  it("LIST-47: Mod is Cmd on macOS and Ctrl elsewhere, for T, W and P only", () => {
    const root = document.createElement("div");
    document.body.append(root);
    try {
      expect(pageShortcut(press({ key: "t", metaKey: true }), root, true)).toBe("new");
      expect(pageShortcut(press({ key: "W", metaKey: true }), root, true)).toBe("close");
      expect(pageShortcut(press({ key: "p", metaKey: true }), root, true)).toBe("find");
      expect(pageShortcut(press({ key: "t", ctrlKey: true }), root, true)).toBeNull();
      expect(pageShortcut(press({ key: "t", ctrlKey: true }), root, false)).toBe("new");
      expect(pageShortcut(press({ key: "t", metaKey: true }), root, false)).toBeNull();
      expect(pageShortcut(press({ key: "k", metaKey: true }), root, true)).toBeNull();
      expect(pageShortcut(press({ key: "t", metaKey: true, altKey: true }), root, true)).toBeNull();
      expect(
        pageShortcut(press({ key: "t", metaKey: true, isComposing: true }), root, true),
      ).toBeNull();
      expect(pageShortcut(press({ key: "t", metaKey: true }), null, true)).toBeNull();
    } finally {
      root.remove();
    }
  });
});
