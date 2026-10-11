// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalView, type TerminalViewProps } from "../components/terminal-view";
import { TerminalPump } from "../lib/pump";
import { createTerminalTransport, REPLAY_TAIL_BYTES } from "../lib/terminal-transport";
import { BB_TERMINAL_FONT_SIZE } from "../lib/theme";
import { fakeSdk, terminal, world } from "./fixtures/fake-bb";

const assets = vi.hoisted(() => ({ url: "" }));
vi.mock("../lib/ghostty", async (original) => {
  const actual = await original<typeof import("../lib/ghostty")>();
  const { GhosttyCore } = await import("@wterm/ghostty");
  return {
    ...actual,
    loadCore: async () =>
      actual.supportAnyEventMouseMode(await GhosttyCore.load({ wasmPath: assets.url })),
  };
});

beforeAll(async () => {
  const bytes = await readFile(
    createRequire(import.meta.url).resolve("@wterm/ghostty/ghostty-vt.wasm"),
  );
  assets.url = `data:application/wasm;base64,${bytes.toString("base64")}`;
});

let visibility: DocumentVisibilityState = "visible";
const pumps: TerminalPump[] = [];

beforeEach(() => {
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    })),
  );
  // A 640×384 view with 8px cells: 80 columns. Rows are ceil(size×1.2) high.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(384);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.tagName === "SPAN" ? (this.textContent?.length ?? 1) * 8 : 640;
    return {
      width,
      height: 16,
      top: 0,
      left: 0,
      right: width,
      bottom: 16,
      x: 0,
      y: 0,
      toJSON() {},
    };
  });
});

afterEach(() => {
  cleanup();
  for (const pump of pumps.splice(0)) pump.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function shell(text: string, overrides: Parameters<typeof terminal>[0] = { id: "term_1" }) {
  const w = world({ terminals: [terminal(overrides)], output: { [overrides.id]: text } });
  return { w, ...fakeSdk(w) };
}

function showView(sdk: TerminalViewProps["sdk"], props: Partial<TerminalViewProps> = {}) {
  return renderSlot(
    { component: TerminalView },
    { sdk, terminalId: "term_1", cols: 80, rows: 24, ...props },
  );
}

const outputCalls = (sdk: ReturnType<typeof fakeSdk>["sdk"]) => sdk.terminals.output.mock.calls;

/** A pump straight over the fake SDK, outside React. */
function pumpOver(
  sdk: ReturnType<typeof fakeSdk>["sdk"],
  size = { cols: 80, rows: 24 },
  fontSize = 13,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const onStatus = vi.fn();
  const pump = new TerminalPump({
    container,
    transport: createTerminalTransport(sdk, "term_1"),
    fontSize,
    size,
    onStatus,
  });
  pumps.push(pump);
  pump.setVisible(true);
  return { pump, container, onStatus };
}

const resizes = (sdk: ReturnType<typeof fakeSdk>["sdk"]) =>
  sdk.terminals.resize.mock.calls.map(([args]) => [args.cols, args.rows]);

describe("terminal view", () => {
  it("VIEW-1: renders with Wterm and Ghostty in bb's theme and the bundled fonts", async () => {
    const { sdk } = shell("hello from ghostty\r\n");
    showView(sdk);
    const renderer = await waitFor(() => {
      const element = document.querySelector<HTMLElement>("[data-renderer=ghostty]");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    await waitFor(() => expect(renderer.textContent).toContain("hello from ghostty"));
    expect(renderer.classList.contains("wterm")).toBe(true);
    expect(renderer.style.getPropertyValue("--term-bg")).toBe("var(--background)");
    expect(renderer.style.getPropertyValue("--term-fg")).toBe("var(--foreground)");
    expect(renderer.style.getPropertyValue("--term-font-family")).toContain("BB FG Nerd Symbols");
    expect(renderer.style.getPropertyValue("--term-font-size")).toBe(`${BB_TERMINAL_FONT_SIZE}px`);
    const styles = await readFile("styles.css", "utf8");
    expect(styles).toContain('@import "./fonts/nerd-symbols.css"');
    const app = await readFile("app.tsx", "utf8");
    expect(app).toContain('import "@wterm/dom/css"');
  });

  it("VIEW-2: shows recent scrollback first, then follows new output with sinceSeq", async () => {
    const { sdk, write } = shell("old line\r\n");
    showView(sdk);
    await waitFor(() => expect(document.body.textContent).toContain("old line"));
    expect(outputCalls(sdk)[0]?.[0]).toEqual({
      terminalId: "term_1",
      tailBytes: REPLAY_TAIL_BYTES,
    });
    write("term_1", "new line\r\n");
    await waitFor(() => expect(document.body.textContent).toContain("new line"));
    const follow = outputCalls(sdk).slice(1);
    expect(follow.length).toBeGreaterThan(0);
    expect(follow.every(([args]) => "sinceSeq" in args && !("tailBytes" in args))).toBe(true);
  });

  it("VIEW-3: polls only while visible: hiding the tab or unmounting stops it", async () => {
    const { sdk } = shell("ready\r\n");
    const view = showView(sdk);
    await waitFor(() => expect(document.body.textContent).toContain("ready"));
    await waitFor(() => expect(outputCalls(sdk).length).toBeGreaterThan(2));

    setVisibility("hidden");
    await new Promise((resolve) => setTimeout(resolve, 400));
    const hidden = outputCalls(sdk).length;
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(outputCalls(sdk).length).toBe(hidden);

    setVisibility("visible");
    await waitFor(() => expect(outputCalls(sdk).length).toBeGreaterThan(hidden));

    view.lifecycle.unmount();
    const unmounted = outputCalls(sdk).length;
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(outputCalls(sdk).length).toBe(unmounted);
  });

  it("VIEW-4: sends resize only while the view has focus", async () => {
    const { sdk } = shell("ready\r\n", { id: "term_1", cols: 100, rows: 30 });
    const { pump, container } = pumpOver(sdk, { cols: 100, rows: 30 });
    await waitFor(() => expect(container.textContent).toContain("ready"));
    pump.fit();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(resizes(sdk)).toEqual([]);

    const input = container.querySelector("textarea");
    if (!input) throw new Error("no input");
    input.focus();
    await waitFor(() => expect(resizes(sdk)).toEqual([[80, 24]]));
    expect(pump.hasFocus()).toBe(true);
  });

  it("VIEW-4: losing focus before the resize is sent cancels it", async () => {
    const { sdk } = shell("ready\r\n", { id: "term_1", cols: 100, rows: 30 });
    const { container } = pumpOver(sdk, { cols: 100, rows: 30 });
    await waitFor(() => expect(container.textContent).toContain("ready"));
    const input = container.querySelector("textarea");
    if (!input) throw new Error("no input");
    input.focus();
    input.blur();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(resizes(sdk)).toEqual([]);
  });

  it("VIEW-4: Wterm focusing its input while it loads is not the user focusing the view", async () => {
    const { sdk } = shell("ready\r\n", { id: "term_1", cols: 100, rows: 30 });
    const { container, pump } = pumpOver(sdk, { cols: 100, rows: 30 });
    await waitFor(() => expect(container.textContent).toContain("ready"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(pump.hasFocus()).toBe(false);
    expect(resizes(sdk)).toEqual([]);
  });

  it("VIEW-4: a terminal opened with focus (new or restarted) fits the pane at once", async () => {
    const { sdk } = shell("ready\r\n", { id: "term_1", cols: 120, rows: 32 });
    showView(sdk, { cols: 120, rows: 32, fresh: true });
    await waitFor(() => expect(document.body.textContent).toContain("ready"));
    // 12px font: 15px rows, so 384px holds 25 of them.
    await waitFor(() => expect(resizes(sdk)).toEqual([[80, 25]]));
    expect(
      document.querySelector("[data-renderer=ghostty]")?.contains(document.activeElement),
    ).toBe(true);
  });

  it("VIEW-8: unfocused, renders at the shell's own columns and rows, whatever the space", async () => {
    const { sdk } = shell("ready\r\n", { id: "term_1", cols: 100, rows: 30 });
    const { pump, container } = pumpOver(sdk, { cols: 100, rows: 30 });
    await waitFor(() => expect(container.textContent).toContain("ready"));
    pump.fit();
    expect([pump.cols(), pump.rows()]).toEqual([100, 30]);

    // Another view resized the shell: follow it locally, never send it back.
    pump.setSessionSize(60, 20);
    expect([pump.cols(), pump.rows()]).toEqual([60, 20]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(resizes(sdk)).toEqual([]);
    expect(container.querySelectorAll(".term-row:not(.term-scrollback-row)")).toHaveLength(20);
  });

  it("VIEW-5: keyboard input reaches the shell and stays away from bb's shortcuts", async () => {
    const { sdk } = shell("ready\r\n");
    showView(sdk);
    await waitFor(() => expect(document.body.textContent).toContain("ready"));
    const input = document.querySelector("textarea");
    if (!input) throw new Error("no input");
    const hostKey = vi.fn();
    document.addEventListener("keydown", hostKey);
    try {
      fireEvent.keyDown(input, { key: "c", code: "KeyC", ctrlKey: true });
      await waitFor(() =>
        expect(sdk.terminals.input).toHaveBeenCalledWith({
          terminalId: "term_1",
          dataBase64: btoa("\x03"),
        }),
      );
      expect(hostKey).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", hostKey);
    }
  });

  it("VIEW-6: Cmd+F opens find, which searches the scrollback", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}${i % 20 === 0 ? " needle" : ""}`);
    const { sdk } = shell(`${lines.join("\r\n")}\r\n`);
    showView(sdk);
    await waitFor(() => expect(document.body.textContent).toContain("line 59"));
    const input = document.querySelector("textarea");
    if (!input) throw new Error("no input");
    fireEvent.keyDown(input, { key: "f", metaKey: true });
    // jsdom does not map <search> to its implicit role yet.
    const find = await screen.findByLabelText("Find in scrollback");
    expect(find.tagName).toBe("SEARCH");
    fireEvent.change(screen.getByPlaceholderText("Find"), { target: { value: "needle" } });
    await waitFor(() => expect(find).toHaveTextContent("1/3"));
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    await waitFor(() => expect(find).toHaveTextContent("2/3"));
  });

  it("VIEW-7: shows the exit code when the terminal exits and keeps the last output", async () => {
    const { sdk, w } = shell("build finished\r\n");
    showView(sdk);
    await waitFor(() => expect(document.body.textContent).toContain("build finished"));
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 3;
    expect(await screen.findByRole("status")).toHaveTextContent("Exited with code 3");
    expect(document.querySelector("[data-renderer=ghostty]")?.textContent).toContain(
      "build finished",
    );
  });
});
