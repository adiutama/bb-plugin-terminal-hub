// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isFilterShortcut } from "../lib/keyboard";

function slash(target: Element, extra: Partial<Parameters<typeof isFilterShortcut>[0]> = {}) {
  return isFilterShortcut({
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

describe("filter shortcut", () => {
  it("LIST-22: `/` on a row or other button focuses the filter", () => {
    expect(slash(html("<ul><li><button>dev</button></li></ul>", "button"))).toBe(true);
  });

  it("LIST-22: `/` in a text field, the terminal view, a menu, or a dialog is left alone", () => {
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

  it("LIST-22: modifiers, composition, other keys, and handled events do not count", () => {
    const button = html("<button>dev</button>", "button");
    expect(slash(button, { metaKey: true })).toBe(false);
    expect(slash(button, { ctrlKey: true })).toBe(false);
    expect(slash(button, { altKey: true })).toBe(false);
    expect(slash(button, { nativeEvent: { isComposing: true } })).toBe(false);
    expect(slash(button, { defaultPrevented: true })).toBe(false);
    expect(slash(button, { key: "?" })).toBe(false);
  });
});
