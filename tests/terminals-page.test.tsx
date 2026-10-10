// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderCount } from "../components/header-count";
import { notFound, terminal, thread, world } from "./fixtures/fake-bb";
import { loadApp, mountPage, openRowMenu, stopFollowing } from "./fixtures/page";

// The real view loads Ghostty's WASM; the page tests only need to know
// which terminal it was asked to show (the view has its own tests).
vi.mock("@/components/terminal-view", () => ({
  TerminalView: ({ terminalId, fresh }: { terminalId: string; fresh?: boolean }) => (
    <div data-testid="terminal-view" data-fresh={fresh ? "" : undefined}>
      {terminalId}
    </div>
  ),
}));

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
    expect(await screen.findByRole("region", { name: "feature" })).toBeTruthy();
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
    render(<HeaderCount />);
    expect(await screen.findByText("2 running")).toBeTruthy();
    cleanup();
    await mountPage(w, "proj_1/all");
    render(<HeaderCount />);
    expect(await screen.findByText("3 running")).toBeTruthy();
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

  it("LIST-10: an environment with no terminals shows an empty state with New terminal", async () => {
    await mountPage(world(), "proj_1/env_a");
    expect(await screen.findByText("No terminals here yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New terminal" })).toBeTruthy();
  });

  it("LIST-13: All shows each environment as a collapsible section with its running count, empty ones collapsed", async () => {
    const w = twoEnvironments();
    w.terminals.push(terminal({ id: "a1", title: "dev" }));
    await mountPage(w, "proj_1/all");
    const main = await screen.findByRole("region", { name: "main" });
    const feature = await screen.findByRole("region", { name: "feature" });
    await within(main).findByText("1 running");
    expect(within(feature).getByText("0 running")).toBeTruthy();
    expect(within(main).getByRole("button", { name: "Collapse main" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(within(feature).getByRole("button", { name: "Expand feature" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(main).getByRole("region", { name: "Environment" })).toBeTruthy();
    fireEvent.click(within(feature).getByRole("button", { name: "Expand feature" }));
    expect(await within(feature).findByRole("button", { name: "New terminal" })).toBeTruthy();
  });

  it("LIST-15: clicking an environment's section header selects that environment", async () => {
    const page = await mountPage(twoEnvironments(), "proj_1/all");
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
    expect(await screen.findByText(/No terminals running here/)).toBeTruthy();
  });
});
