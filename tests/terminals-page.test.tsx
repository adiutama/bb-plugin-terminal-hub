// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeEnvironment, terminal, thread, type World, world } from "./fixtures/fake-bb";
import { loadApp, mountPage, openMenu, stopFollowing } from "./fixtures/page";

// The real view loads Ghostty's WASM; the page tests only need to know
// which terminal it was asked to show, and when (the view has its own tests).
const mounts = vi.hoisted(() => [] as string[]);
/** The mounted view's exit callback, so a test can play the shell exiting. */
const view = vi.hoisted(() => ({
  onExit: null as
    | null
    | ((
        id: string,
        status: "exited" | "gone",
        code: number | null,
        typedAgoMs: number | null,
      ) => void),
}));
vi.mock("@/components/terminal-view", async () => {
  const { useEffect } = await import("react");
  return {
    TerminalView: ({
      terminalId,
      fresh,
      onExit,
    }: {
      terminalId: string;
      fresh?: boolean;
      onExit?: (
        id: string,
        status: "exited" | "gone",
        code: number | null,
        typedAgoMs: number | null,
      ) => void;
    }) => {
      view.onExit = onExit ?? null;
      useEffect(() => {
        mounts.push(`mount ${terminalId}${fresh ? " fresh" : ""}`);
        return () => {
          mounts.push(`unmount ${terminalId}`);
        };
      }, [terminalId]);
      return (
        <div data-testid="terminal-view" data-fresh={fresh ? "" : undefined}>
          {terminalId}
        </div>
      );
    },
  };
});

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  stopFollowing();
  cleanup();
  mounts.splice(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function environment(
  id: string,
  projectId: string,
  overrides: Partial<FakeEnvironment> = {},
): FakeEnvironment {
  return {
    id,
    projectId,
    name: null,
    branchName: id,
    path: `/Users/me/${id}`,
    hostId: "host_1",
    status: "ready",
    ...overrides,
  };
}

/**
 * Two projects: "Project one" with `main` (env_a) and `bb/feature-x`
 * (env_b), and "Project two" with `trunk` (env_c).
 */
function twoProjects(overrides: Partial<World> = {}): World {
  return world({
    projects: [
      { id: "proj_1", name: "Project one" },
      { id: "proj_2", name: "Project two" },
    ],
    environments: [
      ...world().environments,
      environment("env_b", "proj_1", { name: "bb/feature-x", path: "/Users/me/wt/feature-x" }),
      environment("env_c", "proj_2", { name: null, branchName: "trunk", path: "/Users/me/two" }),
    ],
    ...overrides,
  });
}

const rail = () => within(screen.getByRole("navigation", { name: "Environments" }));
const findField = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Find environment" });
/** An environment's button in the rail, if shown. */
const railItem = (environmentId: string) =>
  document.querySelector<HTMLElement>(`[data-environment-id="${environmentId}"]`);
const railItems = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-rail-item]")).map(
    (item) => item.dataset.environmentId,
  );
const projectHeader = (name: string) => rail().getByRole("button", { name });
const tabs = () => within(screen.getByRole("tablist", { name: "Terminals" }));
const tabNames = () =>
  tabs()
    .queryAllByRole("tab")
    .map((tab) => tab.textContent);
const bar = () => within(screen.getByRole("region", { name: "Terminal" }));

/** Leaves the page long enough to count as leaving it. */
async function away(page: { leave(): void }) {
  page.leave();
  await sleep(20);
}

/** Holds a promise open until `release` is called. */
function gate() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Holds every call of `method` until the returned function is called. */
function hold<A extends unknown[], R>(method: {
  getMockImplementation(): ((...args: A) => R) | undefined;
  mockImplementation(fn: (...args: A) => R): unknown;
}) {
  const real = method.getMockImplementation();
  const { promise, release } = gate();
  method.mockImplementation(((...args: A) => promise.then(() => real?.(...args))) as unknown as (
    ...args: A
  ) => R);
  return release;
}

describe("navigation", () => {
  it("NAV-1: registers one navPanel titled Terminals at path terminals", async () => {
    const app = await loadApp();
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({
      id: "terminals",
      title: "Terminals",
      path: "terminals",
    });
  });

  it("NAV-4, NAV-8: without an environment in the URL, selects the environment of the thread bb was showing and its first tab, replacing the entry", async () => {
    const w = twoProjects({
      threads: [thread({ id: "thr_here", environmentId: "env_b" })],
      terminals: [
        terminal({ id: "a1" }),
        terminal({ id: "b1", environmentId: "env_b", createdAt: 1 }),
        terminal({ id: "b2", environmentId: "env_b", createdAt: 2 }),
      ],
    });
    const page = await mountPage(w, "", { projectId: "proj_1", threadId: "thr_here" });
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_b/b1"));
    expect(page.navigations().at(-1)).toEqual({ subPath: "proj_1/env_b/b1", replace: true });
  });

  it("NAV-4: the thread's environment is passed over when the rail does not list it; the environment last shown comes next", async () => {
    const w = twoProjects({
      threads: [thread({ id: "thr_here", environmentId: "env_a" })],
      terminals: [
        terminal({ id: "b1", environmentId: "env_b" }),
        terminal({ id: "c1", environmentId: "env_c" }),
      ],
    });
    const page = await mountPage(w, "proj_2/env_c/c1", {
      projectId: "proj_1",
      threadId: "thr_here",
    });
    await screen.findByTestId("terminal-view");
    page.goTo("");
    await waitFor(() => expect(page.subPath()).toBe("proj_2/env_c/c1"));
  });

  it("NAV-4: otherwise selects the first environment the rail lists, in bb's project order", async () => {
    const w = twoProjects({
      terminals: [
        terminal({ id: "c1", environmentId: "env_c" }),
        terminal({ id: "b1", environmentId: "env_b" }),
      ],
    });
    const page = await mountPage(w, "", { projectId: null });
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_b/b1"));
  });

  it("NAV-4: waits until the rail is listed rather than choosing", async () => {
    const w = twoProjects({ terminals: [terminal({ id: "c1", environmentId: "env_c" })] });
    // Hold the threads: until Project one is listed, it might list something first.
    let release: () => void = () => {};
    const page = await mountPage(w, "", { projectId: null }, (sdk) => {
      release = hold(sdk.threads.list);
    });
    await sleep(50);
    expect(page.subPath()).toBe("");
    release();
    await waitFor(() => expect(page.subPath()).toBe("proj_2/env_c/c1"));
  });

  it("NAV-2: restores project, environment, and terminal from the URL", async () => {
    const w = twoProjects({
      terminals: [
        terminal({ id: "b1", environmentId: "env_b" }),
        terminal({ id: "b2", environmentId: "env_b" }),
      ],
    });
    await mountPage(w, "proj_1/env_b/b2");
    expect((await screen.findByTestId("terminal-view")).textContent).toBe("b2");
    expect(railItem("env_b")).toHaveAttribute("aria-current", "true");
    expect(tabs().getByRole("tab", { selected: true })).toHaveTextContent("b2");
  });

  it("NAV-3: choosing a tab or an environment adds a history entry", async () => {
    const w = twoProjects({
      terminals: [
        terminal({ id: "a1" }),
        terminal({ id: "a2" }),
        terminal({ id: "c1", environmentId: "env_c" }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/a1");
    await screen.findByTestId("terminal-view");
    fireEvent.click(tabs().getByRole("tab", { name: "a2" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/a2"));
    expect(page.navigations().at(-1)).toEqual({ subPath: "proj_1/env_a/a2", replace: false });
    fireEvent.click(railItem("env_c") as HTMLElement);
    await waitFor(() => expect(page.subPath()).toBe("proj_2/env_c/c1"));
    expect(page.navigations().at(-1)).toEqual({ subPath: "proj_2/env_c/c1", replace: false });
  });

  it("NAV-5: a link to a terminal that no longer exists opens its environment with a notice", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const page = await mountPage(w, "proj_1/env_a/t_dead");
    expect(await screen.findByText(/That terminal is gone/)).toBeInTheDocument();
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/a1"));
    expect(page.navigations().every((n) => n.replace)).toBe(true);
  });

  it("NAV-5: a link to an exited terminal says it is gone, with its exit code", async () => {
    const w = world({ terminals: [terminal({ id: "t1", status: "exited", exitCode: 4 })] });
    await mountPage(w, "proj_1/env_a/t1");
    expect(await screen.findByText(/it exited with code 4/)).toBeInTheDocument();
  });

  it("NAV-5: a link to a terminal in an environment the rail does not list opens as NAV-4 says", async () => {
    const w = twoProjects({ terminals: [terminal({ id: "c1", environmentId: "env_c" })] });
    const page = await mountPage(w, "proj_1/env_b/t_dead");
    expect(await screen.findByText(/That terminal is gone/)).toBeInTheDocument();
    await waitFor(() => expect(page.subPath()).toBe("proj_2/env_c/c1"));
  });

  it("NAV-5, LIST-25: a terminal that cannot be reached keeps the link and offers a retry", async () => {
    const w = world();
    const page = await mountPage(w, "proj_1/env_a/t_far", undefined, (sdk) => {
      sdk.terminals.get.mockRejectedValueOnce(new Error("host offline"));
    });
    expect(
      await screen.findByText(/Could not reach this terminal: host offline/),
    ).toBeInTheDocument();
    expect(page.subPath()).toBe("proj_1/env_a/t_far");
    w.terminals.push(terminal({ id: "t_far", threadId: "thr_elsewhere" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("terminal-view")).toHaveTextContent("t_far");
  });

  it("NAV-9, LIST-43: the find text is not in the URL and adds no history entry", async () => {
    const w = twoProjects({ terminals: [terminal({ id: "a1" })] });
    const page = await mountPage(w, "proj_1/env_a/a1");
    await screen.findByTestId("terminal-view");
    const before = page.navigations().length;
    fireEvent.change(findField(), { target: { value: "main" } });
    await sleep(30);
    expect(page.navigations()).toHaveLength(before);
    expect(page.subPath()).toBe("proj_1/env_a/a1");
  });
});

describe("rail", () => {
  it("LIST-33, LIST-1, LIST-8: lists every project in bb's order with its environments that have terminals, thread terminals included", async () => {
    const w = twoProjects({
      environments: [
        ...twoProjects().environments,
        environment("env_empty", "proj_1", { name: "idle-tree" }),
      ],
      threads: [
        thread({ id: "thr_old", environmentId: "env_c", projectId: "proj_2", archivedAt: 5 }),
      ],
      terminals: [
        terminal({ id: "b1", environmentId: "env_b" }),
        terminal({ id: "a1" }),
        terminal({ id: "c1", environmentId: "env_c", threadId: "thr_old" }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/a1");
    await waitFor(() => expect(railItems()).toEqual(["env_a", "env_b", "env_c"]));
    expect(
      rail()
        .getAllByRole("button", { expanded: true })
        .map((b) => b.textContent),
    ).toEqual(["Project one", "Project two"]);
    expect(rail().queryByText("idle-tree")).toBeNull();
    // Every project is listed in full while the page is shown.
    const scanned = page.sdk.threads.list.mock.calls
      .map(([args]) => args.projectId)
      .filter(Boolean);
    expect(new Set(scanned)).toEqual(new Set(["proj_1", "proj_2"]));
  });

  it("LIST-33: a project with no environment listed is left out", async () => {
    const w = twoProjects({ terminals: [terminal({ id: "c1", environmentId: "env_c" })] });
    await mountPage(w, "proj_2/env_c/c1");
    await waitFor(() => expect(railItems()).toEqual(["env_c"]));
    expect(rail().queryByRole("button", { name: "Project one" })).toBeNull();
  });

  it("LIST-34: shows each environment's name as bb gives it, truncated with the full name on hover, and its running count unless zero", async () => {
    const w = twoProjects({
      environments: [
        ...twoProjects().environments,
        environment("env_path", "proj_2", {
          name: null,
          branchName: null,
          path: "/Users/me/checkouts/scratch",
        }),
      ],
      threads: [thread({ id: "thr_b", environmentId: "env_b" })],
      terminals: [
        terminal({ id: "a1" }),
        terminal({ id: "a2" }),
        terminal({ id: "b1", environmentId: "env_b", threadId: "thr_b" }),
        terminal({ id: "c1", environmentId: "env_c" }),
        terminal({ id: "p1", environmentId: "env_path" }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/a1");
    await waitFor(() => expect(railItems()).toHaveLength(4));
    expect(railItem("env_a")).toHaveTextContent(/^main2$/);
    expect(railItem("env_b")).toHaveTextContent(/^bb\/feature-x1$/);
    expect(railItem("env_c")).toHaveTextContent(/^trunk1$/);
    expect(railItem("env_path")).toHaveTextContent(/^scratch1$/);
    const b = railItem("env_b") as HTMLElement;
    expect(b).toHaveAttribute("title", "bb/feature-x\n/Users/me/wt/feature-x");
    expect(within(b).getByText("bb/feature-x")).toHaveClass("truncate");

    // Its only terminal ended: still listed, with no count.
    const ended = w.terminals.find((t) => t.id === "b1");
    if (!ended) throw new Error("fixture");
    ended.status = "exited";
    ended.exitCode = 1;
    page.emitThreadChanged({ id: "thr_b", changes: ["terminals-changed"] });
    await waitFor(() => expect(railItem("env_b")).toHaveTextContent(/^bb\/feature-x$/));
  });

  it("LIST-35: clicking a project header folds and unfolds it without changing the selection; folded projects are remembered", async () => {
    const w = twoProjects({
      terminals: [
        terminal({ id: "a1" }),
        terminal({ id: "b1", environmentId: "env_b" }),
        terminal({ id: "c1", environmentId: "env_c" }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/a1");
    await waitFor(() => expect(railItems()).toHaveLength(3));
    fireEvent.click(projectHeader("Project two"));
    expect(railItems()).toEqual(["env_a", "env_b"]);
    expect(projectHeader("Project two")).toHaveAttribute("aria-expanded", "false");
    // A folded project still shows the selected environment.
    fireEvent.click(projectHeader("Project one"));
    expect(railItems()).toEqual(["env_a"]);
    expect(page.subPath()).toBe("proj_1/env_a/a1");
    await away(page);
    page.returnTo("proj_1/env_a/a1");
    await waitFor(() => expect(railItems()).toEqual(["env_a"]));
    fireEvent.click(projectHeader("Project two"));
    expect(railItems()).toEqual(["env_a", "env_c"]);
  });

  it("LIST-36: clicking an environment selects it with the tab it last showed, else its first; the rail marks it", async () => {
    const w = twoProjects({
      terminals: [
        terminal({ id: "a1" }),
        terminal({ id: "c1", environmentId: "env_c" }),
        terminal({ id: "c2", environmentId: "env_c" }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/a1");
    await waitFor(() => expect(railItems()).toHaveLength(2));
    fireEvent.click(railItem("env_c") as HTMLElement);
    await waitFor(() => expect(page.subPath()).toBe("proj_2/env_c/c1"));
    expect(railItem("env_c")).toHaveAttribute("aria-current", "true");
    expect(railItem("env_a")).not.toHaveAttribute("aria-current");
    fireEvent.click(tabs().getByRole("tab", { name: "c2" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_2/env_c/c2"));
    fireEvent.click(railItem("env_a") as HTMLElement);
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/a1"));
    fireEvent.click(railItem("env_c") as HTMLElement);
    await waitFor(() => expect(page.subPath()).toBe("proj_2/env_c/c2"));
  });

  it("LIST-37, ACT-7: when the selected environment's last tab goes, the next environment below is selected, else the one above", async () => {
    const w = twoProjects({
      terminals: [
        terminal({ id: "a1" }),
        terminal({ id: "b1", environmentId: "env_b" }),
        terminal({ id: "c1", environmentId: "env_c" }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_b/b1");
    await screen.findByTestId("terminal-view");
    const close = async (title: string) => {
      const menu = await openMenu(bar().getByRole("button", { name: `More actions for ${title}` }));
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    };
    await close("b1");
    await waitFor(() => expect(page.subPath()).toBe("proj_2/env_c/c1"));
    expect(railItems()).toEqual(["env_a", "env_c"]);
    expect(page.navigations().at(-1)?.replace).toBe(true);
    await screen.findByTestId("terminal-view");
    await close("c1");
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/a1"));
  });

  it("LIST-41, LIST-40: a project header's + opens New terminal in… with every environment, empty ones included, and starts a shell there", async () => {
    const w = twoProjects({
      environments: [
        ...twoProjects().environments,
        environment("env_empty", "proj_1", { name: "idle-tree" }),
      ],
      terminals: [terminal({ id: "a1" })],
    });
    const page = await mountPage(w, "proj_1/env_a/a1");
    await waitFor(() => expect(railItems()).toEqual(["env_a"]));
    const menu = await openMenu(
      rail().getByRole("button", { name: "New terminal in Project one…" }),
    );
    expect(within(menu).getByText("New terminal in…")).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["main", "bb/feature-x", "idle-tree"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "idle-tree" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_empty/term_new_1"));
    expect(page.sdk.terminals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "environment", environmentId: "env_empty" },
        start: { mode: "shell" },
      }),
    );
    expect(page.navigations().at(-1)?.replace).toBe(false);
    expect(railItems()).toEqual(["env_a", "env_empty"]);
  });

  it("LIST-41: the + shows on hover and focus within the header, and always with a coarse pointer", async () => {
    await mountPage(world({ terminals: [terminal({ id: "a1" })] }), "proj_1/env_a/a1");
    const plus = await rail().findByRole("button", { name: "New terminal in Project one…" });
    expect(plus).toHaveClass(
      "opacity-0",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100",
      "pointer-coarse:opacity-100",
    );
  });

  it("LIST-42: Find environment narrows the rail to environments matching every word: name, project, title, port, or thread", async () => {
    const w = twoProjects({
      threads: [
        thread({
          id: "thr_flaky",
          title: "Fix flaky tests",
          environmentId: "env_c",
          projectId: "proj_2",
        }),
      ],
      terminals: [
        terminal({ id: "a1", title: "vite" }),
        terminal({ id: "b1", environmentId: "env_b", title: "api" }),
        terminal({ id: "c1", environmentId: "env_c", threadId: "thr_flaky", title: "pnpm test" }),
      ],
      output: { a1: "  ➜  Local:   http://localhost:5173/\r\n" },
    });
    const page = await mountPage(w, "proj_1/env_b/b1");
    await waitFor(() => expect(railItems()).toHaveLength(3));
    const find = (text: string) => fireEvent.change(findField(), { target: { value: text } });
    find("5173");
    await waitFor(() => expect(railItems()).toEqual(["env_a"]));
    find("two FLAKY");
    expect(railItems()).toEqual(["env_c"]);
    expect(rail().queryByRole("button", { name: "Project one" })).toBeNull();
    find("feature api");
    expect(railItems()).toEqual(["env_b"]);
    find("   ");
    expect(railItems()).toHaveLength(3);
    // The selected environment stays selected, its tabs shown, while hidden.
    find("trunk");
    expect(railItems()).toEqual(["env_c"]);
    expect(page.subPath()).toBe("proj_1/env_b/b1");
    expect(tabNames()).toEqual(["api"]);
  });

  it("LIST-42: folded projects unfold while the find text is not empty", async () => {
    const w = twoProjects({
      terminals: [terminal({ id: "a1" }), terminal({ id: "c1", environmentId: "env_c" })],
    });
    await mountPage(w, "proj_1/env_a/a1");
    await waitFor(() => expect(railItems()).toHaveLength(2));
    fireEvent.click(projectHeader("Project two"));
    expect(railItems()).toEqual(["env_a"]);
    fireEvent.change(findField(), { target: { value: "trunk" } });
    expect(railItems()).toEqual(["env_c"]);
    fireEvent.change(findField(), { target: { value: "" } });
    expect(railItems()).toEqual(["env_a"]);
  });

  it("LIST-43: says when no environment matches, and keeps the text across leaving and returning", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const page = await mountPage(w, "proj_1/env_a/a1");
    await waitFor(() => expect(railItems()).toHaveLength(1));
    fireEvent.change(findField(), { target: { value: "nowhere" } });
    expect(rail().getByText("No environment matches “nowhere”.")).toBeInTheDocument();
    await away(page);
    page.returnTo("proj_1/env_a/a1");
    expect(findField().value).toBe("nowhere");
  });

  it("LIST-44: `/` focuses the find field and selects its text, but not from a text field; no Cmd/Ctrl+K", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    await mountPage(w, "proj_1/env_a/a1");
    await screen.findByTestId("terminal-view");
    fireEvent.change(findField(), { target: { value: "ma" } });
    const tab = tabs().getByRole("tab", { name: "a1" });
    tab.focus();
    fireEvent.keyDown(tab, { key: "/" });
    expect(document.activeElement).toBe(findField());
    expect(findField().selectionStart).toBe(0);
    expect(findField().selectionEnd).toBe(2);
    // Cmd/Ctrl+K is bb's thread switcher: the page leaves it alone.
    tab.focus();
    const k = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    tab.dispatchEvent(k);
    expect(k.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(tab);
  });

  it("LIST-44: in the field, Escape clears, then moves to the selected environment; ↓ enters the rail; Enter selects the first shown", async () => {
    const w = twoProjects({
      terminals: [terminal({ id: "a1" }), terminal({ id: "c1", environmentId: "env_c" })],
    });
    const page = await mountPage(w, "proj_1/env_a/a1");
    await waitFor(() => expect(railItems()).toHaveLength(2));
    const field = findField();
    field.focus();
    fireEvent.change(field, { target: { value: "trunk" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field.value).toBe("");
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(document.activeElement).toBe(railItem("env_a"));
    field.focus();
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(document.activeElement).toBe(railItem("env_a"));
    field.focus();
    fireEvent.change(field, { target: { value: "trunk" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(page.subPath()).toBe("proj_2/env_c/c1"));
  });

  it("LIST-45: ↓ and ↑ move between environments without wrapping or selecting; ↑ from the first returns to the find field", async () => {
    const w = twoProjects({
      terminals: [
        terminal({ id: "a1" }),
        terminal({ id: "b1", environmentId: "env_b" }),
        terminal({ id: "c1", environmentId: "env_c" }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/a1");
    await waitFor(() => expect(railItems()).toHaveLength(3));
    const a = railItem("env_a") as HTMLElement;
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowDown" });
    expect(document.activeElement).toBe(railItem("env_b"));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(railItem("env_c"));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(railItem("env_c"));
    expect(page.subPath()).toBe("proj_1/env_a/a1");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(document.activeElement).toBe(findField());
    // Enter or Space on a focused environment selects it: it is a button.
    expect(railItem("env_c")?.tagName).toBe("BUTTON");
  });

  it("LIST-29: returning puts the environment that was at the top of the rail back where it was", async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      environment(`env_${i}`, "proj_1", { name: `wt-${i}` }),
    );
    const w = world({
      environments: many,
      terminals: many.map((env) => terminal({ id: `t_${env.id}`, environmentId: env.id })),
    });
    const tops = new WeakMap<Element, number>();
    const scroller = () => {
      const element = screen
        .getByRole("navigation", { name: "Environments" })
        .querySelector<HTMLElement>(".overflow-y-auto");
      if (!element) throw new Error("no scroller");
      return element;
    };
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get(this: Element) {
        return tops.get(this) ?? 0;
      },
      set(this: Element, value: number) {
        tops.set(this, Math.max(0, value));
      },
    });
    const box = (top: number, height: number) =>
      ({ top, bottom: top + height, left: 0, right: 240, width: 240, height }) as DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      if (this.classList.contains("overflow-y-auto")) return box(44, 200);
      const id = (this as HTMLElement).dataset?.environmentId;
      if (id) return box(44 + Number(id.slice(4)) * 28 - scroller().scrollTop, 28);
      return box(0, 0);
    });
    try {
      const page = await mountPage(w, "proj_1/env_0/t_env_0");
      await waitFor(() => expect(railItems()).toHaveLength(20));
      scroller().scrollTop = 290;
      fireEvent.scroll(scroller());
      await sleep(50);
      await away(page);
      page.returnTo("proj_1/env_0/t_env_0");
      await waitFor(() => expect(railItems()).toHaveLength(20));
      // env_10 sat at the top, 10px cut off: it is put back there.
      expect(scroller().scrollTop).toBe(290);
    } finally {
      if (original) Object.defineProperty(Element.prototype, "scrollTop", original);
    }
  });

  it("LIST-17: during the first listing the rail shows its progress; a project that fails shows its error and keeps what it has", async () => {
    const w = twoProjects({ terminals: [terminal({ id: "a1" })] });
    let release: () => void = () => {};
    await mountPage(w, "proj_1/env_a/a1", undefined, (sdk) => {
      release = hold(sdk.threads.list);
    });
    expect(await rail().findByText(/Looking for terminals…/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing running/)).toBeNull();
    release();
    await waitFor(() => expect(rail().queryByText(/Looking for terminals…/)).toBeNull());

    const failing = twoProjects({ terminals: [terminal({ id: "a1" })] });
    cleanup();
    await mountPage(failing, "proj_1/env_a/a1", undefined, (sdk) => {
      const real = sdk.threads.list.getMockImplementation();
      sdk.threads.list.mockImplementation(async (args) => {
        if (args.projectId === "proj_2") throw new Error("bb is restarting");
        return real?.(args) as never;
      });
    });
    expect(await rail().findByText("bb is restarting")).toBeInTheDocument();
    expect(rail().getByRole("button", { name: "Project two" })).toBeInTheDocument();
    expect(railItems()).toEqual(["env_a"]);
  });

  it("LIST-25: with nothing listed, the pane says how far the listing got, and once complete offers New terminal in… for every project's environments", async () => {
    const page = await mountPage(twoProjects(), "", { projectId: null });
    expect(await screen.findByText("Nothing running.")).toBeInTheDocument();
    expect(page.subPath()).toBe("");
    const menu = await openMenu(screen.getByRole("button", { name: "New terminal in…" }));
    expect(
      within(menu)
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label")),
    ).toEqual(["Project one", "Project two"]);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["main", "bb/feature-x", "trunk"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "trunk" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_2/env_c/term_new_1"));
    expect(page.sdk.terminals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "environment", environmentId: "env_c" },
        start: { mode: "shell" },
      }),
    );
    expect(railItems()).toEqual(["env_c"]);

    cleanup();
    await mountPage(twoProjects(), "", { projectId: null }, (sdk) => {
      sdk.threads.list.mockRejectedValue(new Error("bb is restarting"));
    });
    expect(
      await screen.findByText("Could not list every terminal yet; trying again shortly."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing running/)).toBeNull();
    expect(screen.queryByRole("button", { name: "New terminal in…" })).toBeNull();

    cleanup();
    await mountPage(twoProjects(), "", { projectId: null }, (sdk) => {
      hold(sdk.threads.list);
    });
    expect(
      await screen.findByText("Looking for terminals…", { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New terminal in…" })).toBeNull();
  });
});

describe("tabs", () => {
  it("LIST-12: tabs are in creation order, oldest first, whatever the scope", async () => {
    const w = world({
      threads: [
        thread({ id: "thr_new", latestAttentionAt: 9_000 }),
        thread({ id: "thr_old", latestAttentionAt: 1_000 }),
      ],
      terminals: [
        terminal({ id: "t_late", title: "late thread", threadId: "thr_new", createdAt: 40 }),
        terminal({ id: "e2", title: "env two", createdAt: 30 }),
        terminal({ id: "t_early", title: "early thread", threadId: "thr_old", createdAt: 10 }),
        terminal({ id: "e1", title: "env one", createdAt: 20 }),
      ],
    });
    await mountPage(w, "proj_1/env_a/e1");
    await waitFor(() => expect(tabNames()).toHaveLength(4));
    expect(tabNames()).toEqual(["early thread", "env one", "env two", "late thread"]);
  });

  it("LIST-38, LIST-7: a tab shows the title or Terminal, a running server's port, and an ended terminal dimmed with its exit code; nothing else", async () => {
    const w = world({
      threads: [thread({ id: "thr_1", title: "Ship it", status: "idle" })],
      terminals: [
        terminal({ id: "web", title: "dev", createdAt: 1 }),
        terminal({ id: "anon", title: "", createdAt: 2 }),
        terminal({ id: "build", title: "build", createdAt: 3, threadId: "thr_1" }),
      ],
      output: { web: "VITE ready\r\n  ➜  Local:   http://localhost:3000/\r\n" },
    });
    const page = await mountPage(w, "proj_1/env_a/web");
    const web = await screen.findByRole("tab", { name: "dev :3000" });
    expect(tabs().getByRole("tab", { name: "Terminal" })).toBeInTheDocument();
    const build = w.terminals[2];
    if (!build) throw new Error("fixture");
    build.status = "exited";
    build.exitCode = 1;
    page.emitThreadChanged({ id: "thr_1", changes: ["terminals-changed"] });
    const ended = await tabs().findByRole("tab", { name: "build exit 1" });
    expect(ended.parentElement).toHaveClass("text-muted-foreground/60");
    // No status dots, ages, folders, threads, or stale marks.
    expect(ended).not.toHaveTextContent("Ship it");
    expect(web.querySelector("[data-status], [role='img']")).toBeNull();
    expect(screen.getByRole("tablist")).not.toHaveTextContent(/stale|idle|\d+[mhd]\b|~/);
  });

  it("LIST-39: clicking a tab selects it; ← → Home End move and select; the selected tab is kept in view", async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push((this as HTMLElement).dataset.terminalId ?? "");
    };
    const w = world({
      terminals: ["t1", "t2", "t3"].map((id, i) => terminal({ id, createdAt: i })),
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    expect(scrolled).toContain("t1");
    const tab = (name: string) => tabs().getByRole("tab", { name });
    expect(tab("t1")).toHaveAttribute("tabindex", "0");
    expect(tab("t2")).toHaveAttribute("tabindex", "-1");
    fireEvent.click(tab("t2"));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t2"));
    fireEvent.keyDown(tab("t2"), { key: "ArrowRight" });
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t3"));
    expect(document.activeElement).toBe(tab("t3"));
    fireEvent.keyDown(tab("t3"), { key: "ArrowRight" });
    fireEvent.keyDown(tab("t3"), { key: "Home" });
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t1"));
    fireEvent.keyDown(tab("t1"), { key: "End" });
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t3"));
    fireEvent.keyDown(tab("t3"), { key: "ArrowLeft" });
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t2"));
    expect(scrolled.at(-1)).toBe("t2");
    expect(page.navigations().at(-1)?.replace).toBe(false);
  });

  it("LIST-40, VIEW-5: the + after the last tab starts a shell in the selected environment and selects it, answering its startup queries once", async () => {
    const w = world({
      threads: [thread({ id: "thr_1" })],
      terminals: [
        terminal({ id: "e1", title: "env", createdAt: 1 }),
        terminal({ id: "t1", title: "thread", threadId: "thr_1", createdAt: 2 }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/e1");
    await screen.findByTestId("terminal-view");
    fireEvent.click(screen.getByRole("button", { name: "New terminal in main" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/term_new_1"));
    expect(page.sdk.terminals.create).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { kind: "environment", environmentId: "env_a" } }),
    );
    // Always the rightmost tab, whatever the scope of the others.
    expect(tabNames()).toEqual(["env", "thread", "zsh"]);
    await waitFor(() => expect(mounts).toContain("mount term_new_1 fresh"));
    fireEvent.click(tabs().getByRole("tab", { name: "env" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/e1"));
    fireEvent.click(tabs().getByRole("tab", { name: "zsh" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/term_new_1"));
    await waitFor(() => expect(mounts.at(-1)).toBe("mount term_new_1"));
  });

  it("LIST-11, VIEW-7: a selected terminal that exits keeps its tab, stays selected and mounted, until dismissed", async () => {
    const w = world({
      threads: [thread({ id: "thr_1" })],
      terminals: [terminal({ id: "term_1", title: "dev", threadId: "thr_1" })],
    });
    const page = await mountPage(w, "proj_1/env_a/term_1");
    await screen.findByTestId("terminal-view");
    const real = page.sdk.terminals.get.getMockImplementation();
    page.sdk.terminals.get.mockImplementation(async (args) => {
      await sleep(150);
      return real?.(args) as never;
    });
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 3;
    page.emitThreadChanged({ id: "thr_1", changes: ["terminals-changed"] });
    expect(await tabs().findByRole("tab", { name: "dev exit 3" })).toBeInTheDocument();
    await sleep(300);
    expect(page.subPath()).toBe("proj_1/env_a/term_1");
    expect(mounts).toEqual(["mount term_1"]);
    const menu = await openMenu(bar().getByRole("button", { name: "More actions for dev" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /dev/ })).toBeNull());
    expect(page.sdk.terminals.close).not.toHaveBeenCalled();
  });

  it("VIEW-7, LIST-11: when the view sees its terminal exit, the tab shows it at once", async () => {
    const w = world({ terminals: [terminal({ id: "t1", title: "dev" })] });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    await waitFor(() => expect(railItem("env_a")).toHaveTextContent(/^main1$/));
    act(() => view.onExit?.("t1", "exited", 3, null));
    expect(tabs().getByRole("tab", { name: "dev exit 3" })).toBeInTheDocument();
    expect(railItem("env_a")).toHaveTextContent(/^main$/);
    expect(page.subPath()).toBe("proj_1/env_a/t1");
  });

  it("LIST-32, ACT-7: a terminal the user ended from the view goes, and the tab to its right is selected", async () => {
    const w = world({
      terminals: [
        terminal({ id: "t1", title: "shell", createdAt: 1 }),
        terminal({ id: "t2", title: "dev", createdAt: 2 }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 130;
    act(() => view.onExit?.("t1", "exited", 130, 400));
    expect(tabs().queryByRole("tab", { name: /shell/ })).toBeNull();
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t2"));
    await sleep(50);
    expect(tabs().queryByRole("tab", { name: /shell/ })).toBeNull();
  });

  it("LIST-32, LIST-11: a terminal that ends without recent typing in the view keeps its ended tab", async () => {
    const w = world({ terminals: [terminal({ id: "t1", title: "shell" })] });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    act(() => view.onExit?.("t1", "exited", 1, 6_000));
    expect(tabs().getByRole("tab", { name: "shell exit 1" })).toBeInTheDocument();
    expect(page.subPath()).toBe("proj_1/env_a/t1");
  });
});

describe("bar and actions", () => {
  it("VIEW-9: the first line shows the title and, once exited, the exit code; the second where it runs and who owns it", async () => {
    const hour = 3_600_000;
    const w = world({
      threads: [
        thread({ id: "thr_parent", title: "Plan the release", status: "active" }),
        thread({
          id: "thr_1",
          title: "Ship billing",
          status: "idle",
          latestAttentionAt: Date.now() - 2 * hour,
          parentThreadId: "thr_parent",
        }),
      ],
      terminals: [
        terminal({
          id: "web",
          title: "dev server",
          threadId: "thr_1",
          initialCwd: "/Users/me/repo/apps/web",
        }),
      ],
      output: { web: "  ➜  Local:   http://localhost:3000/\r\n" },
    });
    const page = await mountPage(w, "proj_1/env_a/web");
    await screen.findByTestId("terminal-view");
    expect(bar().getByRole("heading", { name: "dev server" })).toBeTruthy();
    expect(bar().getByText("Project one/main apps/web")).toBeTruthy();
    expect(bar().getByText("idle 2h")).toBeTruthy();
    expect(await bar().findByText("spawned by Plan the release")).toBeTruthy();
    fireEvent.click(bar().getByRole("button", { name: "Ship billing" }));
    expect(page.slot.inspection.navigateCalls).toContainEqual(
      expect.objectContaining({ method: "toThread", threadId: "thr_1" }),
    );

    const link = await bar().findByRole("link", { name: /:3000/ });
    expect(link).toHaveAttribute("href", "http://localhost:3000/");
    expect(link).toHaveTextContent("localhost:3000");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.getAttribute("aria-label")).toMatch(/read from recent output/);
    const region = screen.getByRole("region", { name: "Terminal" });
    expect(region).not.toContainElement(screen.getByTestId("terminal-view"));
    expect(region.closest(".th-terminal")).toBeNull();

    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 2;
    page.emitThreadChanged({ id: "thr_1", changes: ["terminals-changed"] });
    expect(await bar().findByText("exit 2")).toBeTruthy();
  });

  it("VIEW-9: the folder is left out at the environment's path and shown with ~ outside it; an active thread shows no state; archived says so", async () => {
    const w = world({
      threads: [
        thread({ id: "thr_on", title: "Busy", status: "active" }),
        thread({ id: "thr_arch", title: "Old work", archivedAt: 10 }),
      ],
      terminals: [
        terminal({
          id: "t1",
          title: "here",
          threadId: "thr_on",
          initialCwd: "/Users/me/repo",
          createdAt: 1,
        }),
        terminal({
          id: "t2",
          title: "away",
          threadId: "thr_arch",
          initialCwd: "/Users/me/elsewhere",
          createdAt: 2,
        }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    expect(bar().getByText("Project one/main")).toBeTruthy();
    expect(bar().queryByText(/idle|archived|active/)).toBeNull();
    fireEvent.click(tabs().getByRole("tab", { name: "away" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t2"));
    expect(await bar().findByText("Project one/main ~/elsewhere")).toBeTruthy();
    expect(bar().getByText("archived")).toBeTruthy();
  });

  it("VIEW-9: keys pressed in the bar never reach the shell", async () => {
    await mountPage(world({ terminals: [terminal({ id: "t1" })] }), "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    const region = screen.getByRole("region", { name: "Terminal" });
    expect(region.closest("[data-terminal-inset]")).toBeNull();
  });

  it("VIEW-10: the terminal sits in an inset box that the view measures inside", async () => {
    await mountPage(world({ terminals: [terminal({ id: "t1" })] }), "proj_1/env_a/t1");
    const terminalView = await screen.findByTestId("terminal-view");
    const inset = terminalView.parentElement;
    expect(inset).toHaveAttribute("data-terminal-inset");
    expect(inset).toHaveClass("px-4", "py-3.5", "min-h-0", "min-w-0", "flex-1");
  });

  it("ACT-8, ACT-2, ACT-3, ACT-4: the bar restarts the shell, and its menu renames and closes with the confirmation", async () => {
    const w = world({
      threads: [thread({ id: "thr_1", title: "Release prep", status: "active" })],
      terminals: [
        terminal({ id: "t0", title: "left", createdAt: 1 }),
        terminal({ id: "t1", title: "pnpm test", threadId: "thr_1", createdAt: 2 }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    fireEvent.click(bar().getByRole("button", { name: "Restart shell" }));
    await waitFor(() =>
      expect(page.sdk.terminals.restart).toHaveBeenCalledWith({ terminalId: "t1" }),
    );

    let menu = await openMenu(bar().getByRole("button", { name: "More actions for pnpm test" }));
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Rename", "Close"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Terminal title" }), {
      target: { value: "tests" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(await bar().findByRole("heading", { name: "tests" })).toBeTruthy();
    expect(page.sdk.terminals.rename).toHaveBeenCalledWith({ terminalId: "t1", title: "tests" });
    expect(tabs().getByRole("tab", { name: "tests" })).toBeInTheDocument();

    menu = await openMenu(bar().getByRole("button", { name: "More actions for tests" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("tests");
    expect(dialog).toHaveTextContent("Release prep");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close terminal" }));
    await waitFor(() =>
      expect(page.sdk.terminals.close).toHaveBeenCalledWith({ terminalId: "t1", mode: "force" }),
    );
    // ACT-7: no tab to the right, so the one to its left.
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t0"));
  });

  it("ACT-4, ACT-7: an environment terminal closes without asking, and the tab to its right is selected", async () => {
    const w = world({
      terminals: ["t1", "t2", "t3"].map((id, i) => terminal({ id, createdAt: i })),
    });
    const page = await mountPage(w, "proj_1/env_a/t2");
    await screen.findByTestId("terminal-view");
    const menu = await openMenu(bar().getByRole("button", { name: "More actions for t2" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t3"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tabNames()).toEqual(["t1", "t3"]);
  });

  it("ACT-6: a close that leaves the terminal running reports an error and keeps the tab", async () => {
    const w = world({ terminals: [terminal({ id: "t1", title: "dev" })] });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    const error = vi.spyOn(toast, "error");
    page.sdk.terminals.close.mockImplementationOnce(
      async () => ({ ...w.terminals[0], status: "running" }) as never,
    );
    const menu = await openMenu(bar().getByRole("button", { name: "More actions for dev" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringMatching(/still running/)));
    expect(tabs().getByRole("tab", { name: "dev" })).toBeInTheDocument();
    expect(page.subPath()).toBe("proj_1/env_a/t1");
  });
});

describe("returning to the page", () => {
  it("LIST-27: shows the last known rail and tabs at once, says Updating… under the find field, and never claims nothing runs", async () => {
    const w = twoProjects({
      threads: [thread({ id: "thr_1" })],
      terminals: [
        terminal({ id: "t1", title: "dev", createdAt: 1 }),
        terminal({ id: "t2", title: "pnpm test", threadId: "thr_1", createdAt: 2 }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await waitFor(() => expect(tabNames()).toEqual(["dev", "pnpm test"]));
    await waitFor(() => expect(railItem("env_a")).toHaveTextContent(/^main2$/));
    expect(rail().queryByText(/Updating…|Reconnecting…/)).toBeNull();
    await away(page);
    w.terminals = [];
    const release = hold(page.sdk.threads.list);
    page.returnTo("proj_1/env_a/t1");
    expect(tabNames()).toEqual(["dev", "pnpm test"]);
    expect(railItems()).toEqual(["env_a"]);
    expect(rail().queryByText(/Looking for terminals/)).toBeNull();
    expect(rail().getByRole("status")).toHaveTextContent("Updating…");
    await sleep(30);
    expect(screen.queryByText(/Nothing running/)).toBeNull();
    release();
    await waitFor(() => expect(rail().queryByText("Updating…")).toBeNull());
  });

  it("LIST-28, NAV-5, ACT-7: a selected terminal that went away meanwhile shows the gone notice and selects as after a close", async () => {
    const w = world({
      terminals: [
        terminal({ id: "t1", title: "dev", createdAt: 1 }),
        terminal({ id: "t2", title: "api", createdAt: 2 }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    await away(page);
    w.terminals = w.terminals.filter((t) => t.id !== "t1");
    page.returnTo("proj_1/env_a/t1");
    expect(await screen.findByText(/That terminal is gone/)).toBeInTheDocument();
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t2"));
  });

  it("LIST-28: on return, the selected terminal is checked first, then its environment, before other projects are listed", async () => {
    const w = twoProjects({
      terminals: [terminal({ id: "a1" }), terminal({ id: "c1", environmentId: "env_c" })],
    });
    const page = await mountPage(w, "proj_2/env_c/c1");
    await screen.findByTestId("terminal-view");
    await sleep(20);
    await away(page);
    page.sdk.terminals.get.mockClear();
    page.sdk.terminals.list.mockClear();
    page.sdk.threads.list.mockClear();
    page.returnTo("proj_2/env_c/c1");
    await waitFor(() =>
      expect(page.sdk.threads.list.mock.calls.some(([a]) => a.projectId === "proj_1")).toBe(true),
    );
    const order = (fn: { mock: { invocationCallOrder: number[] } }, i: number) =>
      fn.mock.invocationCallOrder[i] ?? Infinity;
    const get = order(page.sdk.terminals.get, 0);
    const ownC = page.sdk.terminals.list.mock.calls.findIndex(
      ([a]) => a.scope.kind === "environment" && a.scope.environmentId === "env_c",
    );
    const otherScan = page.sdk.threads.list.mock.calls.findIndex(([a]) => a.projectId === "proj_1");
    expect(page.sdk.terminals.get).toHaveBeenCalledWith({ terminalId: "c1" });
    expect(get).toBeLessThan(order(page.sdk.terminals.list, ownC));
    expect(order(page.sdk.terminals.list, ownC)).toBeLessThan(
      order(page.sdk.threads.list, otherScan),
    );
  });

  it("LIST-27: while bb's realtime connection is down, the lists are last known; when it is back they are confirmed again", async () => {
    const w = world({ terminals: [terminal({ id: "t1" })] });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    await sleep(20);
    expect(rail().queryByText(/Updating…|Reconnecting…/)).toBeNull();
    await page.slot.setRealtimeConnectionState("reconnecting");
    expect(await rail().findByText("Reconnecting…")).toBeInTheDocument();
    expect(tabNames()).toEqual(["t1"]);
    await page.slot.setRealtimeConnectionState("connected");
    await waitFor(() => expect(rail().queryByText(/Updating…|Reconnecting…/)).toBeNull());
  });

  it("NAV-4: back from a page with no environment opens the environment the page last showed", async () => {
    const w = twoProjects({
      terminals: [terminal({ id: "a1" }), terminal({ id: "c1", environmentId: "env_c" })],
    });
    const page = await mountPage(w, "proj_2/env_c/c1", { projectId: null });
    await screen.findByTestId("terminal-view");
    await away(page);
    page.returnTo("");
    await waitFor(() => expect(page.subPath()).toBe("proj_2/env_c/c1"));
  });
});

it("NAV-2: a link naming an environment under the wrong project opens it under its own", async () => {
  const w = twoProjects({ terminals: [terminal({ id: "c1", environmentId: "env_c" })] });
  const page = await mountPage(w, "proj_1/env_c");
  await waitFor(() => expect(page.subPath()).toBe("proj_2/env_c/c1"));
});

it("NAV-2: an old link naming all environments opens as NAV-4 says", async () => {
  const w = world({ terminals: [terminal({ id: "a1" })] });
  const page = await mountPage(w, "proj_1/all");
  await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/a1"));
});

it("NAV-5: a terminal not listed, but running elsewhere, gets a tab and the bar", async () => {
  const w = world({
    terminals: [terminal({ id: "t_far", title: "far", threadId: "thr_unknown" })],
  });
  await mountPage(w, "proj_1/env_a/t_far");
  await screen.findByTestId("terminal-view");
  expect(tabs().getByRole("tab", { name: "far" })).toHaveAttribute("aria-selected", "true");
  expect(railItems()).toEqual(["env_a"]);
  const menu = await openMenu(bar().getByRole("button", { name: "More actions for far" }));
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Terminal title" }), {
    target: { value: "near" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  expect(await bar().findByRole("heading", { name: "near" })).toBeTruthy();
});

it("NAV-5: a dead link is resolved even when another environment cannot be listed", async () => {
  const w = twoProjects({ terminals: [terminal({ id: "a1" })] });
  const page = await mountPage(w, "proj_1/env_a/t_dead", undefined, (sdk) => {
    const real = sdk.terminals.list.getMockImplementation();
    sdk.terminals.list.mockImplementation(async (args) => {
      if (args.scope.kind === "environment" && args.scope.environmentId === "env_b") {
        throw new Error("host offline");
      }
      return real?.(args) as never;
    });
  });
  expect(await screen.findByText(/That terminal is gone/)).toBeInTheDocument();
  await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/a1"));
});

describe("tab close and shortcuts", () => {
  /** A stand-in for bb's own shortcut handling, registered at the document. */
  function bbListener() {
    const seen: string[] = [];
    const listener = (event: KeyboardEvent) => seen.push(event.key);
    document.addEventListener("keydown", listener, { capture: true });
    return {
      seen,
      stop: () => document.removeEventListener("keydown", listener, { capture: true }),
    };
  }
  /** Presses Mod+`key` (Ctrl outside macOS, as in jsdom) on `target`. */
  function mod(target: Element, key: string) {
    const event = new KeyboardEvent("keydown", {
      key,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }
  const closeButton = (name: string) =>
    screen.getByRole("button", { name: new RegExp(`^(Close|Dismiss) ${name}$`) });

  it("LIST-46: every tab has a ×, shown on the selected tab, on hover or focus, and with a coarse pointer, keeping its space when hidden", async () => {
    const w = world({
      terminals: [terminal({ id: "t1", createdAt: 1 }), terminal({ id: "t2", createdAt: 2 })],
    });
    await mountPage(w, "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    const selected = closeButton("t1");
    const other = closeButton("t2");
    expect(selected).toHaveClass("opacity-100");
    expect(other).toHaveClass(
      "opacity-0",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100",
      "pointer-coarse:opacity-100",
    );
    expect(other).not.toHaveClass("hidden");
    // The × sits in the tab, after its label.
    const tab = tabs().getByRole("tab", { name: "t2" });
    expect(tab.parentElement).toContainElement(other);
    expect(tab.parentElement).toHaveClass("group");
    expect(tab.nextElementSibling).toBe(other);
  });

  it("LIST-46, ACT-4, ACT-7: × closes a running environment terminal without asking, asks for a thread terminal, and dismisses an ended one", async () => {
    const w = world({
      threads: [thread({ id: "thr_1", title: "Release prep", status: "active" })],
      terminals: [
        terminal({ id: "t1", title: "one", createdAt: 1 }),
        terminal({ id: "t2", title: "two", threadId: "thr_1", createdAt: 2 }),
        terminal({ id: "t3", title: "three", createdAt: 3 }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    fireEvent.click(closeButton("one"));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t2"));
    expect(page.sdk.terminals.close).toHaveBeenCalledWith({ terminalId: "t1", mode: "force" });
    expect(tabNames()).toEqual(["two", "three"]);

    fireEvent.click(closeButton("two"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Release prep");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close terminal" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t3"));

    act(() => view.onExit?.("t3", "exited", 1, null));
    expect(tabs().getByRole("tab", { name: "three exit 1" })).toBeInTheDocument();
    page.sdk.terminals.close.mockClear();
    fireEvent.click(closeButton("three"));
    await waitFor(() => expect(tabs().queryAllByRole("tab")).toHaveLength(0));
    expect(page.sdk.terminals.close).not.toHaveBeenCalled();
  });

  it("LIST-47, LIST-40: Mod+T starts a shell in the selected environment as the rightmost tab, before bb or the shell sees the key", async () => {
    const w = world({
      terminals: [terminal({ id: "t1", title: "one", createdAt: 1 })],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    const terminalView = await screen.findByTestId("terminal-view");
    const bb = bbListener();
    try {
      const event = mod(terminalView, "t");
      expect(event.defaultPrevented).toBe(true);
      expect(bb.seen).toEqual([]);
      await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/term_new_1"));
      expect(tabNames()).toEqual(["one", "zsh"]);
      expect(page.navigations().at(-1)?.replace).toBe(false);
    } finally {
      bb.stop();
    }
  });

  it("LIST-47, ACT-7: Mod+W does what the selected tab's × does", async () => {
    const w = world({
      threads: [thread({ id: "thr_1", title: "Release prep", status: "active" })],
      terminals: [
        terminal({ id: "t1", title: "one", createdAt: 1 }),
        terminal({ id: "t2", title: "two", threadId: "thr_1", createdAt: 2 }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    const terminalView = await screen.findByTestId("terminal-view");
    mod(terminalView, "w");
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t2"));
    expect(page.sdk.terminals.close).toHaveBeenCalledWith({ terminalId: "t1", mode: "force" });
    mod(await screen.findByTestId("terminal-view"), "W");
    expect(await screen.findByRole("dialog")).toHaveTextContent("Release prep");
  });

  it("LIST-47: Mod+P focuses the find field and selects its text", async () => {
    await mountPage(world({ terminals: [terminal({ id: "t1" })] }), "proj_1/env_a/t1");
    const terminalView = await screen.findByTestId("terminal-view");
    fireEvent.change(findField(), { target: { value: "main" } });
    terminalView.focus();
    const event = mod(document.body, "p");
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(findField());
    expect(findField().selectionStart).toBe(0);
    expect(findField().selectionEnd).toBe(4);
  });

  it("LIST-47: with a dialog or menu open, focus outside the page, other modifiers, or the page left, the keys keep bb's meaning", async () => {
    const w = world({
      threads: [thread({ id: "thr_1", status: "active" })],
      terminals: [terminal({ id: "t1", title: "one", threadId: "thr_1" })],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    const terminalView = await screen.findByTestId("terminal-view");
    const bb = bbListener();
    try {
      // A dialog is open: Mod+W does not reach the page.
      mod(terminalView, "w");
      const dialog = await screen.findByRole("dialog");
      expect(bb.seen).toEqual([]);
      expect(mod(dialog, "w").defaultPrevented).toBe(false);
      expect(bb.seen).toEqual(["w"]);
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      // Focus in bb's own UI, outside the page.
      const outside = document.createElement("input");
      document.body.append(outside);
      outside.focus();
      expect(mod(outside, "t").defaultPrevented).toBe(false);
      outside.remove();

      // Other modifiers, and Mod+K, are bb's.
      const shifted = new KeyboardEvent("keydown", {
        key: "t",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(shifted);
      expect(shifted.defaultPrevented).toBe(false);
      expect(mod(document.body, "k").defaultPrevented).toBe(false);
      expect(page.sdk.terminals.create).not.toHaveBeenCalled();

      await away(page);
      expect(mod(document.body, "t").defaultPrevented).toBe(false);
      expect(page.sdk.terminals.create).not.toHaveBeenCalled();
    } finally {
      bb.stop();
    }
  });
});

it("LIST-34, VIEW-9: same-named environments of a project are told apart by the part of the path that differs, in the rail, the menu, and the bar", async () => {
  const review = (id: string, clone: string) =>
    environment(id, "proj_1", {
      name: null,
      branchName: "feature/review",
      path: `/tmp/T/${clone}/repo`,
    });
  const w = twoProjects({
    environments: [
      ...twoProjects().environments,
      review("env_r1", "review-pr-CuiApF"),
      review("env_r2", "review-pr-Pn4Tl8"),
      // Same branch in another project: names are told apart per project.
      environment("env_other", "proj_2", { name: null, branchName: "feature/review" }),
    ],
    terminals: [
      terminal({ id: "r1", environmentId: "env_r1", initialCwd: "/tmp/T/review-pr-CuiApF/repo" }),
      terminal({ id: "o1", environmentId: "env_other" }),
    ],
  });
  await mountPage(w, "proj_1/env_r1/r1");
  await screen.findByTestId("terminal-view");
  await waitFor(() => expect(railItem("env_r1")).toBeTruthy());
  expect(railItem("env_r1")).toHaveTextContent(/^feature\/review · review-pr-CuiApF1$/);
  expect(railItem("env_r1")).toHaveAttribute(
    "title",
    "feature/review · review-pr-CuiApF\n/tmp/T/review-pr-CuiApF/repo",
  );
  expect(railItem("env_other")).toHaveTextContent(/^feature\/review1$/);
  expect(bar().getByText("Project one/feature/review · review-pr-CuiApF")).toBeTruthy();
  const menu = await openMenu(rail().getByRole("button", { name: "New terminal in Project one…" }));
  expect(
    within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual([
    "main",
    "bb/feature-x",
    "feature/review · review-pr-CuiApF",
    "feature/review · review-pr-Pn4Tl8",
  ]);
});
