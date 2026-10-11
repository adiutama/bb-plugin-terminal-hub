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
    expect(await screen.findByRole("button", { name: "Show 2 empty environments" })).toBeTruthy();
  });

  it("NAV-2: restores project, environment, and terminal from the URL", async () => {
    const w = twoEnvironments();
    w.terminals.push(terminal({ id: "term_b", title: "api", environmentId: "env_b" }));
    await mountPage(w, "proj_1/env_b/term_b");
    expect(await screen.findByTestId("terminal-view")).toHaveTextContent("term_b");
    expect(screen.getByRole("combobox", { name: "Environment" })).toHaveTextContent("feature");
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("Project one");
    const row = (await screen.findByText("api")).closest("li");
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
    expect(await screen.findByText("exit 3")).toBeInTheDocument();
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
    await screen.findByRole("button", { name: "Show 2 empty environments" });
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
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
    expect(await screen.findByText("zsh")).toBeTruthy();
  });

  it("LIST-10: an environment with no terminals says so; the page says how to start one", async () => {
    await mountPage(world(), "proj_1/env_a");
    expect(await screen.findByText("No terminals here yet.")).toBeTruthy();
    expect(
      await screen.findByText("No terminals found. Start one with New terminal in…"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "New terminal" })).toBeTruthy();
  });

  it("LIST-13: All shows environments with terminals as expanded sections, in BB's order, and hides the empty ones", async () => {
    const w = manyEnvironments(3);
    w.terminals.push(
      terminal({ id: "a1", title: "dev" }),
      terminal({ id: "c1", title: "api", environmentId: "env_2" }),
    );
    await mountPage(w, "proj_1/all");
    const main = await screen.findByRole("region", { name: "main" });
    await within(main).findByText("1 running");
    expect(within(main).getByRole("button", { name: "Collapse main" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(within(main).getByRole("region", { name: "Environment" })).toBeTruthy();
    expect(
      screen
        .getAllByRole("region")
        .map((region) => region.getAttribute("aria-label"))
        .filter((name) => name === "main" || name?.startsWith("wt-")),
    ).toEqual(["main", "wt-2"]);
    expect(screen.queryByRole("region", { name: "wt-0" })).toBeNull();

    const disclosure = screen.getByRole("button", { name: "Show 2 empty environments" });
    fireEvent.click(disclosure);
    const hidden = await screen.findByRole("region", { name: "Empty environments" });
    expect(
      within(hidden)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["wt-00 running", "wt-10 running"]);
    expect(disclosure).toHaveTextContent("Hide empty environments");
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
  });

  it("LIST-13, LIST-10: forty empty environments are one disclosure, and the page says nothing is running", async () => {
    await mountPage(manyEnvironments(39), "proj_1/all");
    expect(await screen.findByRole("button", { name: "Show 40 empty environments" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Collapse|^Expand/ })).toBeNull();
    expect(screen.getByText("No terminals found. Start one with New terminal in…")).toBeTruthy();
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
    expect(within(feature).getByText("0 running")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show 1 empty environment" })).toBeTruthy();
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
    expect(screen.queryByRole("button", { name: /empty environment/ })).toBeNull();
    slow.release();
    expect(
      await screen.findByText("No terminals found. Start one with New terminal in…"),
    ).toBeTruthy();
    expect(screen.queryByText(/Scanning threads/)).toBeNull();
    expect(screen.getByRole("button", { name: "Show 1 empty environment" })).toBeTruthy();
  });

  it("LIST-17: a failed first scan shows the error, not an empty list", async () => {
    const page = await mountPage(twoEnvironments(), "proj_1/all");
    page.sdk.threads.list.mockRejectedValue(new Error("bb is restarting"));
    expect(await screen.findByText("bb is restarting")).toBeTruthy();
    expect(screen.queryByText(/No terminals found/)).toBeNull();
    expect(screen.queryByRole("button", { name: /empty environment/ })).toBeNull();
    expect(screen.getByText(/Could not list every terminal yet/)).toBeTruthy();
  });

  it("LIST-16: the summary counts running terminals, servers, and stale ones; stale opens the cleanup", async () => {
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
    await waitFor(() => expect(summary).toHaveTextContent("3 running·1 server·1 stale"));
    fireEvent.click(within(summary).getByRole("button", { name: "1 stale" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Close all from settled threads?");
    expect(dialog).toHaveTextContent("pnpm test");
  });

  it("LIST-16: leaves out zero servers and stale terminals", async () => {
    await mountPage(world({ terminals: [terminal({ id: "sh" })] }), "proj_1/env_a");
    const summary = await screen.findByRole("region", { name: "Summary" });
    await waitFor(() => expect(summary).toHaveTextContent(/^1 running$/));
  });

  it("LIST-15: clicking an environment's section header selects that environment", async () => {
    const w = twoEnvironments();
    w.terminals.push(terminal({ id: "a1" }));
    const page = await mountPage(w, "proj_1/all");
    fireEvent.click(await screen.findByRole("button", { name: /^main/ }));
    await waitFor(() => expect(page.subPath()).toBe("proj_1/env_a"));
  });

  it("LIST-2, LIST-3: shows groups, and the owning thread's title and state on thread rows", async () => {
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
    expect(within(fromThreads).getByText("“Fix flaky tests” · idle")).toBeTruthy();
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
    fireEvent.click(
      await screen.findByRole("button", { name: "Close all from settled threads (2)" }),
    );
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
    expect(
      await screen.findByRole("button", { name: "Close all from settled threads (3)" }),
    ).toBeTruthy();
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
