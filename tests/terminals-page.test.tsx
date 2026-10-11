// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderCount } from "../components/header-count";
import { notFound, terminal, thread, world } from "./fixtures/fake-bb";
import { loadApp, mountPage, openRowMenu, stopFollowing } from "./fixtures/page";

// The real view loads Ghostty's WASM; the page tests only need to know
// which terminal it was asked to show, and when (the view has its own tests).
const mounts = vi.hoisted(() => [] as string[]);
vi.mock("@/components/terminal-view", async () => {
  const { useEffect } = await import("react");
  return {
    TerminalView: ({ terminalId, fresh }: { terminalId: string; fresh?: boolean }) => {
      useEffect(() => {
        mounts.push(`mount ${terminalId}`);
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
  mounts.splice(0);
  stopFollowing();
  cleanup();
  vi.unstubAllGlobals();
});

const twoEnvironments = () =>
  world({
    environments: [
      ...world().environments,
      {
        id: "env_b",
        projectId: "proj_1",
        name: "feature",
        branchName: "feature",
        path: "/Users/me/wt",
        hostId: "host_1",
        status: "ready",
      },
    ],
  });

/** `count` environments, `env_0` … named `wt-0` …, after env_a ("main"). */
const manyEnvironments = (count: number) =>
  world({
    environments: [
      ...world().environments,
      ...Array.from({ length: count }, (_, i) => ({
        id: `env_${i}`,
        projectId: "proj_1",
        name: `wt-${i}`,
        branchName: null,
        path: `/Users/me/wt-${i}`,
        hostId: "host_1",
        status: "ready",
      })),
    ],
  });

/** The left column: the pickers, the list, and its summary. */
const sidebar = () => within(screen.getByRole("complementary", { name: "Terminal list" }));

/** Holds a promise open until `release` is called. */
function gate() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
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
    expect(app.navPanels[0]?.headerContent).toBeTypeOf("function");
  });

  it("NAV-4: without a project in the URL, selects the current project", async () => {
    const page = await mountPage(world(), "", { projectId: "proj_1" });
    await waitFor(() => expect(page.subPath()).toBe("proj_1/all"));
    expect(page.navigations()[0]).toEqual({ subPath: "proj_1/all", replace: true });
  });

  it("NAV-4: without a project in the URL or context, selects the first project", async () => {
    const w = world({
      projects: [
        { id: "proj_first", name: "First" },
        { id: "proj_1", name: "Second" },
      ],
    });
    const page = await mountPage(w, "", { projectId: null });
    await waitFor(() => expect(page.subPath()).toBe("proj_first/all"));
  });

  it("NAV-7: without an environment in the URL, selects All environments and writes all", async () => {
    const page = await mountPage(twoEnvironments(), "proj_1");
    await waitFor(() => expect(page.subPath()).toBe("proj_1/all"));
    expect(page.navigations()[0]?.replace).toBe(true);
    expect(await screen.findByRole("combobox", { name: "Environment" })).toHaveTextContent(
      "All environments",
    );
    expect(
      await screen.findByText("No terminals found. Start one with New terminal in…"),
    ).toBeTruthy();
  });

  it("NAV-2: restores project, environment, and terminal from the URL", async () => {
    const w = twoEnvironments();
    w.terminals.push(terminal({ id: "term_b", title: "api", environmentId: "env_b" }));
    await mountPage(w, "proj_1/env_b/term_b");
    expect(await screen.findByTestId("terminal-view")).toHaveTextContent("term_b");
    expect(screen.getByRole("combobox", { name: "Environment" })).toHaveTextContent("feature");
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("Project one");
    const row = (await sidebar().findByText("api")).closest("li");
    expect(row && within(row).getAllByRole("button")[0]).toHaveAttribute("aria-current", "true");
  });

  it("NAV-3: selecting a terminal adds a history entry", async () => {
    const w = world({
      terminals: [terminal({ id: "t1", title: "one" }), terminal({ id: "t2", title: "two" })],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    fireEvent.click(await screen.findByText("two"));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t2"));
    expect(page.navigations().at(-1)).toEqual({ subPath: "proj_1/env_a/t2", replace: false });
  });

  it("NAV-8: changing the environment replaces the history entry", async () => {
    const w = twoEnvironments();
    w.terminals.push(terminal({ id: "tb", environmentId: "env_b" }));
    const page = await mountPage(w, "proj_1/all");
    fireEvent.click(await screen.findByRole("button", { name: /^feature/ }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_b"));
    expect(page.navigations().at(-1)).toEqual({ subPath: "proj_1/env_b", replace: true });
  });

  it("NAV-5: a link to a terminal that no longer exists opens its environment with a notice", async () => {
    const w = world({ terminals: [terminal({ id: "t1", title: "one" })] });
    const page = await mountPage(w, "proj_1/env_a/term_gone");
    expect(await screen.findByText(/That terminal is gone/)).toBeTruthy();
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a"));
    expect(page.navigations().at(-1)?.replace).toBe(true);
    expect(screen.getByText("one")).toBeTruthy();
  });

  it("NAV-5: a link to an exited terminal says it is gone, with its exit code", async () => {
    const w = world({ terminals: [terminal({ id: "t_done", status: "exited", exitCode: 2 })] });
    await mountPage(w, "proj_1/env_a/t_done");
    expect(await screen.findByText(/exited with code 2/)).toBeTruthy();
  });

  it("NAV-5: going back to a terminal that exited after a project switch says it is gone", async () => {
    const w = world({
      projects: [
        { id: "proj_1", name: "Project one" },
        { id: "proj_2", name: "Project two" },
      ],
      terminals: [terminal({ id: "t1", title: "one" }), terminal({ id: "t2", title: "two" })],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await screen.findByText("two");
    page.goTo("proj_2/all");
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 0;
    page.goTo("proj_1/env_a/t1");
    expect(await screen.findByText(/That terminal is gone/)).toBeInTheDocument();
  });

  it("NAV-5: a terminal that cannot be reached keeps the link and offers a retry", async () => {
    const w = world();
    const page = await mountPage(w, "proj_1/env_a/term_remote");
    page.sdk.terminals.get.mockRejectedValueOnce(new Error("machine offline"));
    expect(await screen.findByText(/Could not reach this terminal: machine offline/)).toBeTruthy();
    expect(page.subPath()).toBe("proj_1/env_a/term_remote");
    page.sdk.terminals.get.mockRejectedValueOnce(notFound());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/That terminal is gone/)).toBeTruthy();
  });

  it("NAV-6: the title bar shows the running count for the environment, or the project with All", async () => {
    const w = twoEnvironments();
    w.terminals.push(
      terminal({ id: "a1" }),
      terminal({ id: "a2" }),
      terminal({ id: "b1", environmentId: "env_b" }),
    );
    await mountPage(w, "proj_1/env_a");
    let header = render(<HeaderCount />).container;
    expect(await within(header).findByText("2 running")).toBeTruthy();
    cleanup();
    await mountPage(w, "proj_1/all");
    header = render(<HeaderCount />).container;
    expect(await within(header).findByText("3 running")).toBeTruthy();
  });
});

describe("terminal view on the page", () => {
  it("VIEW-7, LIST-11: a selected terminal that exits stays selected and mounted, even when bb answers slowly", async () => {
    const w = world({
      threads: [thread({ id: "thr_1" })],
      terminals: [terminal({ id: "term_1", title: "dev", threadId: "thr_1" })],
    });
    const page = await mountPage(w, "proj_1/env_a/term_1");
    await screen.findByTestId("terminal-view");
    const real = page.sdk.terminals.get.getMockImplementation();
    page.sdk.terminals.get.mockImplementation(async (args) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return real?.(args) as never;
    });
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 3;
    page.emitThreadChanged({ id: "thr_1", changes: ["terminals-changed"] });
    expect(await sidebar().findByText("exit 3")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(page.subPath()).toBe("proj_1/env_a/term_1");
    expect(screen.queryByText(/That terminal is gone/)).toBeNull();
    expect(mounts).toEqual(["mount term_1"]);
  });

  it("VIEW-5: answers a new shell's startup queries on its first view only", async () => {
    const w = world({ terminals: [terminal({ id: "t_old", title: "old" })] });
    const page = await mountPage(w, "proj_1/env_a");
    fireEvent.click(await screen.findByRole("button", { name: "New terminal" }));
    expect(await screen.findByTestId("terminal-view")).toHaveAttribute("data-fresh");
    fireEvent.click(await screen.findByText("old"));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t_old"));
    fireEvent.click(await screen.findByText("zsh"));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/term_new_1"));
    expect(await screen.findByTestId("terminal-view")).not.toHaveAttribute("data-fresh");
  });

  it("NAV-5: resolves a dead link even when one environment cannot be listed", async () => {
    const w = twoEnvironments();
    const page = await mountPage(w, "proj_1/all/term_gone");
    const real = page.sdk.terminals.list.getMockImplementation();
    page.sdk.terminals.list.mockImplementation(async (args) => {
      if (args.scope.kind === "environment" && args.scope.environmentId === "env_b") {
        throw new Error("host offline");
      }
      return real?.(args) as never;
    });
    expect(await screen.findByText(/That terminal is gone/)).toBeInTheDocument();
    expect(
      await screen.findByText("Could not list this environment's terminals: host offline"),
    ).toBeInTheDocument();
  });
});

describe("session list", () => {
  it("LIST-9: New terminal starts a shell at environment scope and selects it", async () => {
    const page = await mountPage(world(), "proj_1/env_a");
    fireEvent.click(await screen.findByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/term_new_1"));
    expect(page.sdk.terminals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "environment", environmentId: "env_a" },
        start: { mode: "shell" },
      }),
    );
    expect(page.navigations().at(-1)?.replace).toBe(false);
    expect(await screen.findByTestId("terminal-view")).toHaveAttribute("data-fresh");
  });

  it("LIST-9: in All with nothing selected, New terminal opens the menu, and a hidden empty environment can be chosen", async () => {
    const page = await mountPage(twoEnvironments(), "proj_1/all");
    await screen.findByText("No terminals found. Start one with New terminal in…");
    fireEvent.click(sidebar().getByRole("button", { name: "New terminal" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["main", "feature"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "feature" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/all/term_new_1"));
    expect(page.sdk.terminals.create).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { kind: "environment", environmentId: "env_b" } }),
    );
    const feature = await screen.findByRole("region", { name: "feature" });
    expect(within(feature).getByText("zsh")).toBeTruthy();
  });

  it("LIST-9: the menu lists the selected environment first; from one environment, choosing another switches to it", async () => {
    const page = await mountPage(twoEnvironments(), "proj_1/env_b");
    const trigger = await screen.findByRole("button", { name: "New terminal in…" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["feature", "main"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "main" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/term_new_1"));
    expect(await sidebar().findByText("zsh")).toBeTruthy();
  });

  it("LIST-10: an environment with no terminals says so; the page says how to start one", async () => {
    await mountPage(world(), "proj_1/env_a");
    expect(await screen.findByText("No terminals here yet.")).toBeTruthy();
    expect(
      await screen.findByText("No terminals found. Start one with New terminal in…"),
    ).toBeTruthy();
    expect(sidebar().getByRole("button", { name: "New terminal in main" })).toBeTruthy();
  });

  it("LIST-13: All shows environments with terminals as expanded sections, in BB's order, and leaves out the empty ones", async () => {
    const w = manyEnvironments(3);
    w.terminals.push(
      terminal({ id: "a1", title: "dev" }),
      terminal({ id: "c1", title: "api", environmentId: "env_2" }),
    );
    await mountPage(w, "proj_1/all");
    const main = await screen.findByRole("region", { name: "main" });
    const toggle = within(main).getByRole("button", { name: "Collapse main" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The name, its running count, and the toggle: separate parts of the header.
    await waitFor(() => expect(toggle.parentElement).toHaveTextContent(/^main1 running$/));
    expect(within(main).getByRole("button", { name: "main" })).not.toContainElement(toggle);
    expect(within(main).getByRole("region", { name: "Environment" })).toBeTruthy();
    expect(
      screen
        .getAllByRole("region")
        .map((region) => region.getAttribute("aria-label"))
        .filter((name) => name === "main" || name?.startsWith("wt-")),
    ).toEqual(["main", "wt-2"]);
    expect(screen.queryByRole("region", { name: "wt-0" })).toBeNull();
    expect(screen.queryByRole("button", { name: /empty environment/ })).toBeNull();
    expect(screen.queryByText(/^wt-[01]$/)).toBeNull();

    // Still reachable from "New terminal in…".
    const trigger = sidebar().getByRole("button", { name: "New terminal in…" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "wt-0" })).toBeTruthy();
  });

  it("LIST-13, LIST-10: forty empty environments list nothing, and the page says nothing is running", async () => {
    await mountPage(manyEnvironments(39), "proj_1/all");
    expect(
      await screen.findByText("No terminals found. Start one with New terminal in…"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Collapse|^Expand/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /empty environment/ })).toBeNull();
    expect(sidebar().queryByText(/^wt-/)).toBeNull();
  });

  it("LIST-13, LIST-11: an environment whose last terminal exits keeps its section and shows the exit code", async () => {
    const w = twoEnvironments();
    w.threads.push(thread({ id: "thr_b", environmentId: "env_b" }));
    w.terminals.push(
      terminal({ id: "b1", title: "build", threadId: "thr_b", environmentId: "env_b" }),
    );
    const page = await mountPage(w, "proj_1/all");
    const feature = await screen.findByRole("region", { name: "feature" });
    await within(feature).findByText("build");
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 3;
    page.emitThreadChanged({ id: "thr_b", changes: ["terminals-changed"] });
    expect(await within(feature).findByText("exit 3")).toBeInTheDocument();
    expect(
      within(feature).getByRole("button", { name: "Collapse feature" }).parentElement,
    ).toHaveTextContent("0 running");
    expect(screen.queryByRole("region", { name: "main" })).toBeNull();
  });

  it("LIST-17: while the first scan is slow, the list shows its progress and never says nothing is there", async () => {
    const w = world({ threads: [thread({ id: "thr_1" }), thread({ id: "thr_2" })] });
    const page = await mountPage(w, "proj_1/all");
    const slow = gate();
    const real = page.sdk.terminals.list.getMockImplementation();
    page.sdk.terminals.list.mockImplementation(async (args) => {
      if (args.scope.kind === "thread" && args.scope.threadId === "thr_2") await slow.promise;
      return real?.(args) as never;
    });
    expect(await screen.findByText("Scanning threads… 1 of 2")).toBeTruthy();
    expect(screen.queryByText(/No terminals found/)).toBeNull();
    slow.release();
    expect(
      await screen.findByText("No terminals found. Start one with New terminal in…"),
    ).toBeTruthy();
    expect(screen.queryByText(/Scanning threads/)).toBeNull();
  });

  it("LIST-17: a failed first scan shows the error, not an empty list", async () => {
    const page = await mountPage(twoEnvironments(), "proj_1/all");
    page.sdk.threads.list.mockRejectedValue(new Error("bb is restarting"));
    expect(await screen.findByText("bb is restarting")).toBeTruthy();
    expect(screen.queryByText(/No terminals found/)).toBeNull();
    expect(screen.getByText(/Could not list every terminal yet/)).toBeTruthy();
  });

  it("LIST-16, ACT-5: the summary counts running terminals and servers; Clean up N stale opens the cleanup", async () => {
    const w = world({
      threads: [thread({ id: "thr_idle", title: "Release prep", status: "idle" })],
      terminals: [
        terminal({ id: "web", title: "dev server" }),
        terminal({ id: "sh", title: "zsh" }),
        terminal({ id: "left", title: "pnpm test", threadId: "thr_idle" }),
      ],
      output: { web: "  ➜  Local:   http://localhost:5173/\r\n" },
    });
    await mountPage(w, "proj_1/all");
    const summary = await screen.findByRole("region", { name: "Summary" });
    await waitFor(() => expect(summary).toHaveTextContent("3 running·1 serverClean up 1 stale"));
    fireEvent.click(within(summary).getByRole("button", { name: "Clean up 1 stale" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Close all from settled threads?");
    expect(dialog).toHaveTextContent("pnpm test");
  });

  it("LIST-16: leaves out zero servers and stale terminals", async () => {
    await mountPage(world({ terminals: [terminal({ id: "sh" })] }), "proj_1/env_a");
    const summary = await screen.findByRole("region", { name: "Summary" });
    await waitFor(() => expect(summary).toHaveTextContent(/^1 running$/));
    expect(within(summary).queryByRole("button")).toBeNull();
  });

  it("LIST-15: clicking an environment's section header selects that environment", async () => {
    const w = twoEnvironments();
    w.terminals.push(terminal({ id: "a1" }));
    const page = await mountPage(w, "proj_1/all");
    fireEvent.click(await screen.findByRole("button", { name: "main" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a"));
  });

  it("LIST-2, LIST-3: shows headed groups when both kinds are there, and the owning thread's title and state on thread rows", async () => {
    const w = world({
      threads: [thread({ id: "thr_1", title: "Fix flaky tests", status: "idle" })],
      terminals: [
        terminal({ id: "env_t", title: "dev server" }),
        terminal({ id: "thr_t", title: "pnpm test", threadId: "thr_1" }),
      ],
    });
    await mountPage(w, "proj_1/env_a");
    const environment = await screen.findByRole("region", { name: "Environment" });
    const fromThreads = await screen.findByRole("region", { name: "From threads" });
    expect(within(environment).getByText("dev server")).toBeTruthy();
    expect(within(fromThreads).getByText("pnpm test")).toBeTruthy();
    expect(within(environment).getByRole("heading", { name: "Environment" })).toBeTruthy();
    expect(within(fromThreads).getByRole("heading", { name: "From threads" })).toBeTruthy();
    const line = within(fromThreads).getByText("Fix flaky tests").parentElement;
    expect(line).toHaveTextContent("Fix flaky tests· idle");
  });

  it("LIST-2: leaves out the heading when only one kind is shown, also after filtering", async () => {
    const w = world({
      threads: [thread({ id: "thr_1", title: "Fix flaky tests", status: "active" })],
      terminals: [
        terminal({ id: "env_t", title: "dev server" }),
        terminal({ id: "thr_t", title: "pnpm test", threadId: "thr_1" }),
      ],
    });
    await mountPage(w, "proj_1/env_a");
    await sidebar().findByRole("heading", { name: "From threads" });
    fireEvent.change(sidebar().getByRole("textbox", { name: "Filter terminals" }), {
      target: { value: "pnpm" },
    });
    const fromThreads = await screen.findByRole("region", { name: "From threads" });
    await waitFor(() => expect(within(fromThreads).queryByRole("heading")).toBeNull());
    expect(within(fromThreads).getByText("pnpm test")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Environment" })).toBeNull();
  });
});

describe("actions", () => {
  const withThread = () =>
    world({
      threads: [
        thread({ id: "thr_idle", title: "Release prep", status: "idle" }),
        thread({ id: "thr_arch", title: "Old work", archivedAt: 50 }),
        thread({ id: "thr_live", title: "Busy", status: "active" }),
      ],
      terminals: [
        terminal({ id: "env_t", title: "dev server" }),
        terminal({ id: "idle_t", title: "pnpm test", threadId: "thr_idle" }),
        terminal({ id: "arch_t", title: "watch", threadId: "thr_arch" }),
        terminal({ id: "live_t", title: "build", threadId: "thr_live" }),
      ],
    });

  it("ACT-1: each row's menu offers Rename, Restart shell, and Close", async () => {
    await mountPage(withThread(), "proj_1/env_a");
    const menu = await openRowMenu("dev server");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Rename", "Restart shell", "Close"]);
  });

  it("ACT-2: Rename sets the title through the SDK", async () => {
    const page = await mountPage(withThread(), "proj_1/env_a");
    const menu = await openRowMenu("dev server");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: "Terminal title" });
    fireEvent.change(input, { target: { value: "web" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() =>
      expect(page.sdk.terminals.rename).toHaveBeenCalledWith({ terminalId: "env_t", title: "web" }),
    );
    expect(await screen.findByText("web")).toBeTruthy();
  });

  it("ACT-3: Restart shell restarts through the SDK", async () => {
    const page = await mountPage(withThread(), "proj_1/env_a/env_t");
    const menu = await openRowMenu("dev server");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Restart shell" }));
    await waitFor(() =>
      expect(page.sdk.terminals.restart).toHaveBeenCalledWith({ terminalId: "env_t" }),
    );
  });

  it("ACT-4: an environment terminal closes without asking", async () => {
    const page = await mountPage(withThread(), "proj_1/env_a");
    const menu = await openRowMenu("dev server");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    await waitFor(() =>
      expect(page.sdk.terminals.close).toHaveBeenCalledWith({ terminalId: "env_t", mode: "force" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ACT-4: a thread terminal asks first, naming the terminal and its thread", async () => {
    const page = await mountPage(withThread(), "proj_1/env_a");
    const menu = await openRowMenu("pnpm test");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("pnpm test");
    expect(dialog).toHaveTextContent("Release prep");
    expect(page.sdk.terminals.close).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close terminal" }));
    await waitFor(() =>
      expect(page.sdk.terminals.close).toHaveBeenCalledWith({
        terminalId: "idle_t",
        mode: "force",
      }),
    );
  });

  it("ACT-5: closes every running terminal of settled threads after one confirmation listing each", async () => {
    const page = await mountPage(withThread(), "proj_1/env_a");
    fireEvent.click(await screen.findByRole("button", { name: "Clean up 2 stale" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("pnpm test");
    expect(dialog).toHaveTextContent("Release prep");
    expect(dialog).toHaveTextContent("watch");
    expect(dialog).toHaveTextContent("Old work");
    expect(dialog).not.toHaveTextContent("build");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close 2" }));
    await waitFor(() => expect(page.sdk.terminals.close).toHaveBeenCalledTimes(2));
    expect(page.sdk.terminals.close.mock.calls.map(([args]) => args.terminalId).sort()).toEqual([
      "arch_t",
      "idle_t",
    ]);
  });

  it("ACT-5: with All selected, cleanup covers the whole project", async () => {
    const w = twoEnvironments();
    w.threads.push(thread({ id: "thr_b", environmentId: "env_b" }));
    w.terminals.push(
      terminal({ id: "a", threadId: "thr_b", environmentId: "env_b" }),
      terminal({ id: "b", threadId: "thr_b", environmentId: "env_b" }),
    );
    w.threads.push(thread({ id: "thr_a" }));
    w.terminals.push(terminal({ id: "c", threadId: "thr_a" }));
    await mountPage(w, "proj_1/all");
    expect(await screen.findByRole("button", { name: "Clean up 3 stale" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Close all from settled threads/ })).toBeNull();
  });

  it("ACT-6: a close that leaves the terminal running reports an error and keeps the row", async () => {
    const page = await mountPage(withThread(), "proj_1/env_a");
    page.sdk.terminals.close.mockResolvedValueOnce(terminal({ id: "env_t", status: "running" }));
    const menu = await openRowMenu("dev server");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    await waitFor(() => expect(page.sdk.terminals.close).toHaveBeenCalled());
    expect(screen.getByText("dev server")).toBeTruthy();
  });

  it("ACT-7: closing the selected terminal selects the next one, or the empty state", async () => {
    const w = world({
      terminals: [terminal({ id: "t1", title: "one" }), terminal({ id: "t2", title: "two" })],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    let menu = await openRowMenu("one");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t2"));
    menu = await openRowMenu("two");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a"));
    expect(await screen.findByText(/No terminals found/)).toBeTruthy();
  });

  it("ACT-7: in All, the next selection skips a collapsed section and never wraps", async () => {
    const w = manyEnvironments(2);
    w.terminals.push(
      terminal({ id: "a1", title: "one" }),
      terminal({ id: "b1", title: "two", environmentId: "env_0" }),
      terminal({ id: "c1", title: "three", environmentId: "env_1" }),
    );
    const page = await mountPage(w, "proj_1/all/a1");
    fireEvent.click(await screen.findByRole("button", { name: "Collapse wt-0" }));
    let menu = await openRowMenu("one");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/all/c1"));
    menu = await openRowMenu("three");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/all"));
  });

  it("ACT-7: dismissing an environment's last row moves to the next environment's terminal", async () => {
    const w = manyEnvironments(1);
    w.terminals.push(
      terminal({ id: "a1", title: "one" }),
      terminal({ id: "b1", title: "two", environmentId: "env_0" }),
    );
    const page = await mountPage(w, "proj_1/all/a1");
    await screen.findByTestId("terminal-view");
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 0;
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss one" }, { timeout: 7000 }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/all/b1"));
    expect(screen.queryByRole("region", { name: "main" })).toBeNull();
  }, 10_000);
});

describe("filter and keyboard", () => {
  const filterBox = () =>
    screen.findByRole<HTMLInputElement>("textbox", { name: "Filter terminals" });
  const type = async (text: string) => {
    const input = await filterBox();
    fireEvent.change(input, { target: { value: text } });
    return input;
  };
  /** The main button of the row titled `title`. */
  const rowButton = async (title: string) => {
    const button = (await sidebar().findByText(title)).closest("button");
    if (!button) throw new Error(`no row ${title}`);
    return button;
  };

  it("LIST-18: typing narrows the list to matching rows, server hints included", async () => {
    const w = world({
      threads: [thread({ id: "thr_1", title: "Fix flaky tests" })],
      terminals: [
        terminal({ id: "web", title: "dev server" }),
        terminal({ id: "sh", title: "zsh" }),
        terminal({ id: "t", title: "pnpm test", threadId: "thr_1" }),
      ],
      output: { web: "  ➜  Local:   http://localhost:3000/\r\n" },
    });
    await mountPage(w, "proj_1/all");
    expect(await screen.findByPlaceholderText("Filter terminals, environments, threads…")).toBe(
      await filterBox(),
    );
    const summary = await screen.findByRole("region", { name: "Summary" });
    await waitFor(() => expect(summary).toHaveTextContent("1 server"));
    await type("3000");
    expect(await screen.findByText("dev server")).toBeTruthy();
    expect(screen.queryByText("zsh")).toBeNull();
    expect(screen.queryByRole("region", { name: "From threads" })).toBeNull();
    await type("flaky pnpm");
    expect(await screen.findByText("pnpm test")).toBeTruthy();
    expect(screen.queryByText("dev server")).toBeNull();
    await type("   ");
    expect(await screen.findByText("zsh")).toBeTruthy();
    await type("nothing");
    expect(await screen.findByText("No terminals match “nothing”.")).toBeTruthy();
  });

  it("LIST-18: the selected terminal's row hides when it does not match, and its view stays open", async () => {
    const w = world({
      terminals: [terminal({ id: "t1", title: "one" }), terminal({ id: "t2", title: "two" })],
    });
    await mountPage(w, "proj_1/all/t1");
    await sidebar().findByText("one");
    await type("two");
    await waitFor(() => expect(sidebar().queryByText("one")).toBeNull());
    expect(screen.getByTestId("terminal-view")).toHaveTextContent("t1");
  });

  it("LIST-19: a collapsed section opens while filtering, and is collapsed again after", async () => {
    const w = manyEnvironments(1);
    w.terminals.push(
      terminal({ id: "a1", title: "one" }),
      terminal({ id: "b1", title: "two", environmentId: "env_0" }),
    );
    await mountPage(w, "proj_1/all");
    fireEvent.click(await screen.findByRole("button", { name: "Collapse wt-0" }));
    expect(screen.queryByText("two")).toBeNull();
    await type("two");
    const section = await screen.findByRole("region", { name: "wt-0" });
    expect(within(section).getByText("two")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^(Collapse|Expand) / })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(await screen.findByRole("button", { name: "Expand wt-0" })).toBeTruthy();
    expect(screen.queryByText("two")).toBeNull();
  });

  it("LIST-19, LIST-20, LIST-22: matching empty environments follow the no-match message; Enter selects the first", async () => {
    const w = manyEnvironments(3);
    w.terminals.push(terminal({ id: "a1", title: "one" }));
    const page = await mountPage(w, "proj_1/all");
    await screen.findByText("Select a terminal to see it here.");
    const input = await type("wt- 1");
    const empty = await screen.findByRole("region", { name: "Empty environments" });
    expect(
      within(empty)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["wt-1"]);
    expect(screen.getByText("No terminals match “wt- 1”.")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_1"));
    expect(input).toHaveValue("wt- 1");

    // From the header itself, focus stays in the page once the header is gone.
    page.goTo("proj_1/all");
    const header = await screen.findByRole("button", { name: "wt-1" });
    header.focus();
    fireEvent.click(header);
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_1"));
    expect(document.activeElement).toBe(input);
  });

  it("LIST-19, LIST-20: before the list is complete, no empty environments or no-match message", async () => {
    const w = manyEnvironments(2);
    w.threads.push(thread({ id: "thr_1" }), thread({ id: "thr_2" }));
    const page = await mountPage(w, "proj_1/all");
    const slow = gate();
    const real = page.sdk.terminals.list.getMockImplementation();
    page.sdk.terminals.list.mockImplementation(async (args) => {
      if (args.scope.kind === "thread" && args.scope.threadId === "thr_2") await slow.promise;
      return real?.(args) as never;
    });
    await type("wt");
    expect(await screen.findByText(/Scanning threads…/)).toBeTruthy();
    expect(screen.queryByText(/No terminals match/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Empty environments" })).toBeNull();
    slow.release();
    expect(await screen.findByRole("region", { name: "Empty environments" })).toBeTruthy();
    expect(screen.getByText("No terminals match “wt”.")).toBeTruthy();
  });

  it("LIST-19: an environment that failed to list keeps its section and error", async () => {
    const w = twoEnvironments();
    w.terminals.push(terminal({ id: "a1", title: "one" }));
    const page = await mountPage(w, "proj_1/all");
    const real = page.sdk.terminals.list.getMockImplementation();
    page.sdk.terminals.list.mockImplementation(async (args) => {
      if (args.scope.kind === "environment" && args.scope.environmentId === "env_b") {
        throw new Error("host offline");
      }
      return real?.(args) as never;
    });
    await screen.findByText("Could not list this environment's terminals: host offline");
    await type("one");
    expect(await screen.findByRole("region", { name: "feature" })).toHaveTextContent(
      "host offline",
    );
    expect(screen.getByText("one")).toBeTruthy();
  });

  it("LIST-20: in a single environment, says nothing matches once listed", async () => {
    await mountPage(world({ terminals: [terminal({ id: "t1", title: "one" })] }), "proj_1/env_a");
    await screen.findByText("one");
    await type("zzz");
    expect(await screen.findByText("No terminals match “zzz”.")).toBeTruthy();
    expect(screen.queryByText("No terminals here yet.")).toBeNull();
  });

  it("LIST-21: the filter survives an environment change, clears on a project change, and the summary ignores it", async () => {
    const w = world({
      projects: [
        { id: "proj_1", name: "Project one" },
        { id: "proj_2", name: "Project two" },
      ],
      terminals: [terminal({ id: "t1", title: "one" }), terminal({ id: "t2", title: "two" })],
    });
    const page = await mountPage(w, "proj_1/all");
    const input = await type("one");
    const summary = await screen.findByRole("region", { name: "Summary" });
    await waitFor(() => expect(summary).toHaveTextContent(/^2 running$/));
    fireEvent.click(await screen.findByRole("button", { name: "main" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a"));
    expect(await filterBox()).toHaveValue("one");
    expect(screen.queryByText("two")).toBeNull();
    page.goTo("proj_2/all");
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("LIST-22: `/` focuses the filter and selects its text, but not from a text field", async () => {
    const w = world({ terminals: [terminal({ id: "t1", title: "one" })] });
    await mountPage(w, "proj_1/env_a");
    const input = await filterBox();
    fireEvent.change(input, { target: { value: "on" } });
    const row = await rowButton("one");
    row.focus();
    fireEvent.keyDown(row, { key: "/" });
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2]);

    // A click on blank space focuses the page itself.
    const page = input.closest<HTMLElement>('[tabindex="-1"]');
    if (!page) throw new Error("no focusable page root");
    page.focus();
    fireEvent.keyDown(page, { key: "/" });
    expect(document.activeElement).toBe(input);

    const menu = await openRowMenu("one");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const title = await screen.findByRole("textbox", { name: "Terminal title" });
    title.focus();
    fireEvent.keyDown(title, { key: "/" });
    expect(document.activeElement).toBe(title);
  });

  it("LIST-22: Escape clears the filter, then moves to the selected row; ↓ enters the list; Enter selects the first row", async () => {
    const w = world({
      terminals: [terminal({ id: "t1", title: "one" }), terminal({ id: "t2", title: "two" })],
    });
    const page = await mountPage(w, "proj_1/env_a/t2");
    const input = await type("o");
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.activeElement).toBe(await rowButton("two"));

    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(await rowButton("one"));

    fireEvent.change(input, { target: { value: "one" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t1"));
  });

  it("LIST-23: arrows, Home, and End move focus without wrapping or selecting; ↑ from the first returns to the filter", async () => {
    const w = world({
      terminals: [
        terminal({ id: "t1", title: "one" }),
        terminal({ id: "t2", title: "two" }),
        terminal({ id: "t3", title: "three" }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    const [one, two, three] = [
      await rowButton("one"),
      await rowButton("two"),
      await rowButton("three"),
    ];
    const navigated = page.navigations().length;
    one.focus();
    fireEvent.keyDown(one, { key: "ArrowDown" });
    expect(document.activeElement).toBe(two);
    fireEvent.keyDown(two, { key: "End" });
    expect(document.activeElement).toBe(three);
    fireEvent.keyDown(three, { key: "ArrowDown" });
    expect(document.activeElement).toBe(three);
    fireEvent.keyDown(three, { key: "Home" });
    expect(document.activeElement).toBe(one);
    fireEvent.keyDown(one, { key: "ArrowUp" });
    expect(document.activeElement).toBe(await filterBox());
    expect(page.navigations()).toHaveLength(navigated);
    expect(page.subPath()).toBe("proj_1/env_a/t1");
    // Enter and Space select through the native button.
    expect(two.tagName).toBe("BUTTON");
    expect(two).toHaveAttribute("type", "button");
  });

  it("LIST-23: keys on a row's ⋯ button keep their meaning, and Tab order is unchanged", async () => {
    const w = world({
      terminals: [terminal({ id: "t1", title: "one" }), terminal({ id: "t2", title: "two" })],
    });
    await mountPage(w, "proj_1/env_a");
    const trigger = await screen.findByRole("button", { name: "Actions for one" });
    const two = await rowButton("two");
    for (const button of [
      await rowButton("one"),
      two,
      trigger,
      screen.getByRole("button", { name: "Actions for two" }),
    ]) {
      expect(button).not.toHaveAttribute("tabindex", "-1");
    }
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(await screen.findByRole("menu")).toBeTruthy();
    expect(document.activeElement).not.toBe(two);
  });

  it("NAV-9: typing in the filter adds no history entry, and opening the page again starts unfiltered", async () => {
    const w = world({ terminals: [terminal({ id: "t1", title: "one" })] });
    const page = await mountPage(w, "proj_1/env_a");
    await screen.findByText("one");
    const navigated = page.navigations().length;
    await type("zzz");
    await screen.findByText(/No terminals match/);
    expect(page.navigations()).toHaveLength(navigated);
    expect(page.subPath()).toBe("proj_1/env_a");
    stopFollowing();
    cleanup();
    await mountPage(w, "proj_1/env_a");
    expect(await filterBox()).toHaveValue("");
    expect(await screen.findByText("one")).toBeTruthy();
  });

  it("ACT-7: with a filter, closing the selected terminal selects the next matching row", async () => {
    const w = world({
      terminals: [
        terminal({ id: "t1", title: "dev one" }),
        terminal({ id: "t2", title: "zsh" }),
        terminal({ id: "t3", title: "dev two" }),
      ],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await type("dev");
    const menu = await openRowMenu("dev one");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a/t3"));
  });
});

describe("page layout", () => {
  /** The bar above the selected terminal. */
  const bar = () => within(screen.getByRole("region", { name: "Terminal" }));

  /** Opens a menu from its trigger with the keyboard, as Radix expects in jsdom. */
  const openMenu = async (trigger: HTMLElement) => {
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    return screen.findByRole("menu");
  };

  it("LIST-26: the project and environment pickers sit on one line as borderless triggers, project first", async () => {
    await mountPage(twoEnvironments(), "proj_1/env_b");
    const project = await screen.findByRole("combobox", { name: "Project" });
    const environment = screen.getByRole("combobox", { name: "Environment" });
    expect(project.parentElement).toBe(environment.parentElement);
    expect(project.compareDocumentPosition(environment)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    for (const trigger of [project, environment]) expect(trigger).toHaveClass("border-0");
    const list = sidebar();
    const order = [
      environment,
      list.getByRole("button", { name: "New terminal in feature" }),
      list.getByRole("textbox", { name: "Filter terminals" }),
      list.getByRole("region", { name: "Summary" }),
    ];
    for (const [index, element] of order.slice(1).entries()) {
      expect(order[index]?.compareDocumentPosition(element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("LIST-9: the main part names the environment it starts in, when there is one", async () => {
    const page = await mountPage(twoEnvironments(), "proj_1/env_b");
    fireEvent.click(await sidebar().findByRole("button", { name: "New terminal in feature" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_b/term_new_1"));
    page.goTo("proj_1/all");
    expect(await sidebar().findByRole("button", { name: "New terminal" })).toHaveTextContent(
      /^New terminal$/,
    );
  });

  it("LIST-25: with no terminal selected, the pane says so and offers New terminal and the list's keys", async () => {
    const w = twoEnvironments();
    w.terminals.push(terminal({ id: "t1", title: "one" }));
    const page = await mountPage(w, "proj_1/all");
    const main = within(await screen.findByRole("main"));
    expect(await main.findByText("Select a terminal to see it here.")).toBeTruthy();
    const keys = screen.getByText("filter").closest("[data-key-hints]");
    expect(keys).toHaveClass("hidden", "pointer-fine:flex");
    expect(keys).toHaveTextContent("/filter↑↓move↵open");
    // No environment to start in: the main part opens the menu, as LIST-9's does.
    fireEvent.click(main.getByRole("button", { name: "New terminal" }));
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "feature" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/all/term_new_1"));
  });

  it("LIST-25, LIST-9: in one environment, the pane's New terminal names where it starts", async () => {
    const page = await mountPage(twoEnvironments(), "proj_1/env_b");
    const main = within(await screen.findByRole("main"));
    fireEvent.click(await main.findByRole("button", { name: "New terminal in feature" }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_b/term_new_1"));
  });

  it("LIST-15, LIST-16, LIST-18: environment names, Clean up, and Clear filter are at least 32px on a coarse pointer", async () => {
    const w = world({
      threads: [thread({ id: "thr_idle", status: "idle" })],
      terminals: [terminal({ id: "left", title: "pnpm test", threadId: "thr_idle" })],
    });
    await mountPage(w, "proj_1/all");
    expect(await screen.findByRole("button", { name: "main" })).toHaveClass(
      "pointer-coarse:min-h-8",
    );
    expect(await screen.findByRole("button", { name: "Clean up 1 stale" })).toHaveClass(
      "pointer-coarse:min-h-8",
    );
    fireEvent.change(sidebar().getByRole("textbox", { name: "Filter terminals" }), {
      target: { value: "pnpm" },
    });
    expect(await screen.findByRole("button", { name: "Clear filter" })).toHaveClass(
      "pointer-coarse:size-8",
    );
  });

  it("LIST-25: no New terminal button while still looking or after a failed listing", async () => {
    const w = world({ threads: [thread({ id: "thr_1" })] });
    const page = await mountPage(w, "proj_1/all");
    page.sdk.threads.list.mockRejectedValue(new Error("bb is restarting"));
    const main = within(await screen.findByRole("main"));
    expect(await main.findByText(/Could not list every terminal yet/)).toBeTruthy();
    expect(main.queryByRole("button", { name: /^New terminal/ })).toBeNull();
  });

  it("VIEW-9: the bar shows the title, environment, exit code, and a link to the server hint, outside the terminal view", async () => {
    const w = world({
      threads: [thread({ id: "thr_1", status: "active" })],
      terminals: [terminal({ id: "web", title: "dev server", threadId: "thr_1" })],
      output: { web: "  ➜  Local:   http://localhost:3000/\r\n" },
    });
    const page = await mountPage(w, "proj_1/env_a/web");
    await screen.findByTestId("terminal-view");
    expect(bar().getByRole("heading", { name: "dev server" })).toBeTruthy();
    expect(bar().getByText("main")).toBeTruthy();
    const link = await bar().findByRole("link", { name: /:3000/ });
    expect(link).toHaveAttribute("href", "http://localhost:3000/");
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

  it("VIEW-10: the terminal sits in an inset box that the view measures inside", async () => {
    await mountPage(world({ terminals: [terminal({ id: "t1" })] }), "proj_1/env_a/t1");
    const view = await screen.findByTestId("terminal-view");
    const inset = view.parentElement;
    expect(inset).toHaveAttribute("data-terminal-inset");
    expect(inset).toHaveClass("px-4", "py-3.5", "min-h-0", "min-w-0", "flex-1");
  });

  it("ACT-8: the bar restarts the shell, and its menu renames and closes with the row's confirmation", async () => {
    const w = world({
      threads: [thread({ id: "thr_1", title: "Release prep", status: "idle" })],
      terminals: [terminal({ id: "t1", title: "pnpm test", threadId: "thr_1" })],
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

    menu = await openMenu(bar().getByRole("button", { name: "More actions for tests" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Release prep");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close terminal" }));
    await waitFor(() =>
      expect(page.sdk.terminals.close).toHaveBeenCalledWith({ terminalId: "t1", mode: "force" }),
    );
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a"));
  });

  it("ACT-8: Close on an exited terminal dismisses its row", async () => {
    const w = world({
      threads: [thread({ id: "thr_1", status: "active" })],
      terminals: [terminal({ id: "t1", title: "build", threadId: "thr_1" })],
    });
    const page = await mountPage(w, "proj_1/env_a/t1");
    await screen.findByTestId("terminal-view");
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 1;
    page.emitThreadChanged({ id: "thr_1", changes: ["terminals-changed"] });
    await sidebar().findByText("exit 1");
    const menu = await openMenu(bar().getByRole("button", { name: "More actions for build" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
    await waitFor(() => expect(sidebar().queryByText("build")).toBeNull());
    expect(page.sdk.terminals.close).not.toHaveBeenCalled();
  });

  it("ACT-8: renaming a linked terminal the list does not hold updates the bar", async () => {
    const w = world({
      terminals: [terminal({ id: "t_far", title: "far", threadId: "thr_unknown" })],
    });
    await mountPage(w, "proj_1/env_a/t_far");
    await screen.findByTestId("terminal-view");
    expect(bar().getByRole("heading", { name: "far" })).toBeTruthy();
    const menu = await openMenu(bar().getByRole("button", { name: "More actions for far" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Terminal title" }), {
      target: { value: "near" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(await bar().findByRole("heading", { name: "near" })).toBeTruthy();
  });
});
