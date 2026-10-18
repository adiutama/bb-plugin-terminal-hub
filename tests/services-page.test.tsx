// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COUNT_REFRESH_MS,
  FORCE_STOP_AFTER_MS,
  SERVICES_REFRESH_MS,
} from "../components/services-page";
import type { World } from "./fixtures/fake-bb";
import { type Machine, STARTED_AT } from "./fixtures/fake-host";
import { loadApp, mountPage, openMenu, stopFollowing } from "./fixtures/page";
import {
  disposeServers,
  servicesMachine,
  servicesWorld,
  startServer,
} from "./fixtures/services-world";

const METHODS = ["services.list", "services.plan", "services.stop", "services.log"] as const;

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
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

afterEach(async () => {
  stopFollowing();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await disposeServers();
});

/** The title bar's Services button (SVC-1). */
const servicesButton = () =>
  within(screen.getByTestId("title-bar")).getByRole("button", { name: /^Services/ });

/**
 * The Terminals page and its title bar over a server running on `m`, its RPC
 * wired through; with `open`, switched to the Services view.
 */
async function mountServices(
  w: World = servicesWorld(),
  m: Machine = servicesMachine(),
  { open = true }: { open?: boolean } = {},
) {
  const server = await startServer(w, m);
  const rpc = Object.fromEntries(
    METHODS.map((method) => [method, vi.fn((input: unknown) => server.call(method, input))]),
  );
  const page = await mountPage(w, "", { projectId: null }, undefined, rpc);
  if (open) fireEvent.click(servicesButton());
  return { slot: page.slot, page, server, rpc };
}

const table = () => screen.getByRole("table", { name: "Services" });
const row = (pid: number) => {
  const found = table().querySelector<HTMLElement>(`[data-service-pid="${pid}"]`);
  if (!found) throw new Error(`no row for ${pid}`);
  return found;
};
const drawer = () => screen.getByRole("region", { name: "Log" });
/** SVC-7: a row's ⋯ menu. */
const rowMenu = (pid: number) =>
  openMenu(within(row(pid)).getByRole("button", { name: /^More actions for / }));
/** SVC-8: Stop… from a row's ⋯ menu. */
async function stopFromRow(pid: number) {
  const menu = await rowMenu(pid);
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Stop…" }));
}
const listCalls = (rpc: Record<string, { mock: { calls: unknown[] } }>) =>
  rpc["services.list"]!.mock.calls.length;

/** Lets fake timers run `ms` ahead, settling the RPC promises they start. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("services page", () => {
  it("SVC-1: no page for services; the Terminals page's title bar holds the Services button", async () => {
    const app = await loadApp();
    expect(app.navPanels.map((p) => p.id)).toEqual(["terminals"]);
    expect(app.navPanels[0]?.headerContent).toBeTypeOf("function");
  });

  it("SVC-1: the button shows the count, switches the main view to Services and back, pressed while shown; the rail stays", async () => {
    await mountServices(servicesWorld(), servicesMachine(), { open: false });
    await waitFor(() => expect(servicesButton()).toHaveTextContent("Services3"));
    expect(servicesButton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Services" })).toBeNull();
    fireEvent.click(servicesButton());
    expect(servicesButton()).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("table", { name: "Services" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Environments" })).toBeInTheDocument();
    fireEvent.click(servicesButton());
    expect(servicesButton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Services" })).toBeNull();
  });

  it("SVC-1: with no listed service, the button shows no count", async () => {
    const m = servicesMachine();
    m.processes = m.processes.filter((p) => ![48345, 33438, 51002].includes(p.pid));
    const { rpc } = await mountServices(servicesWorld(), m, { open: false });
    await waitFor(() => expect(listCalls(rpc)).toBe(1));
    await act(async () => {});
    expect(servicesButton()).toHaveTextContent(/^Services$/);
  });

  it("SVC-4, SVC-24: one full-width table with Port, Program, Started by, Up, and a ⋯ menu; a row per process, no PID column", async () => {
    vi.setSystemTime(STARTED_AT + 2 * 3_600_000);
    await mountServices();
    await screen.findByRole("table", { name: "Services" });
    const headers = within(table().querySelector("thead") as HTMLElement)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers).toEqual(["Port", "Program", "Started by", "Up", "Actions"]);
    expect(table()).toHaveClass("w-full");
    const vite = within(row(51002)).getAllByRole("cell");
    expect(vite).toHaveLength(5);
    expect(vite[0]).toHaveTextContent(":5173 :24678");
    expect(vite[1]).toHaveTextContent(/^node$/);
    expect(row(51002)).not.toHaveTextContent("51002");
    const up = within(row(33438)).getAllByRole("cell")[3]!;
    expect(up).toHaveTextContent("2h");
    expect(up).toHaveClass("text-right");
    expect(
      within(row(33438)).getByRole("button", { name: /^More actions for / }),
    ).toBeInTheDocument();
  });

  it("SVC-24: the program is the file name of the command's first word; hovering shows the full command line", async () => {
    await mountServices();
    await screen.findByRole("table", { name: "Services" });
    const program = within(row(33438)).getByText("postgres");
    expect(within(row(48345)).getAllByRole("cell")[1]).toHaveTextContent(/^node$/);
    fireEvent.focus(program);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "/opt/homebrew/bin/postgres -D /Users/me/.agents/pg -p 55400",
    );
  });

  it("SVC-14, SVC-11: rows under headers with the project's initial, its name, and the environment, in bb's order; another host's says not checked", async () => {
    await mountServices();
    await screen.findByRole("table", { name: "Services" });
    const headers = within(table())
      .getAllByRole("columnheader")
      .filter((th) => th.getAttribute("scope") === "colgroup")
      .map((th) => th.textContent);
    expect(headers).toEqual([
      "Kkai-platformbb/map-all-page-urls",
      "Kkai-platformremote-box",
      "Tterminal-hubmain",
    ]);
    const groups = table().querySelectorAll("tbody");
    expect(within(groups[0] as HTMLElement).getAllByRole("row")).toHaveLength(3);
    expect(groups[1]).toHaveTextContent("Not checked: this environment is on another machine.");
  });

  it("SVC-18: a known starting thread is a link that opens the thread without selecting the row; others leave the cell empty", async () => {
    const { slot } = await mountServices();
    await screen.findByRole("table", { name: "Services" });
    fireEvent.click(within(row(48345)).getByRole("button", { name: "Map all page URLs" }));
    expect(slot.inspection.navigateCalls.at(-1)).toMatchObject({
      method: "toThread",
      threadId: "thr_map",
    });
    expect(row(48345)).not.toHaveAttribute("data-selected");
    expect(screen.queryByRole("region", { name: "Log" })).toBeNull();
    expect(within(row(51002)).getAllByRole("cell")[2]).toBeEmptyDOMElement();
  });

  it("SVC-15: the header shows the title and a find field; finding narrows rows by every word, the PID included", async () => {
    await mountServices();
    await screen.findByRole("table", { name: "Services" });
    const view = screen.getByRole("region", { name: "Services" });
    expect(within(view).getByRole("heading", { name: "Services" })).toBeInTheDocument();
    expect(view).not.toHaveTextContent("running");
    const find = screen.getByRole("textbox", { name: "Find service" });
    const shownPids = () =>
      Array.from(table().querySelectorAll<HTMLElement>("[data-service-pid]")).map((r) =>
        Number(r.dataset.servicePid),
      );
    fireEvent.change(find, { target: { value: "5540" } });
    expect(shownPids()).toEqual([33438, 48345]);
    fireEvent.change(find, { target: { value: "KAI postgres" } });
    expect(shownPids()).toEqual([33438]);
    // The environment's name, the PID, and the full command line.
    fireEvent.change(find, { target: { value: "main 51002" } });
    expect(shownPids()).toEqual([51002]);
    fireEvent.change(find, { target: { value: "apps/api" } });
    expect(shownPids()).toEqual([48345]);
    // Groups with no row left are hidden, the other host's included.
    fireEvent.change(find, { target: { value: "vite" } });
    expect(table()).not.toHaveTextContent("kai-platform");
    fireEvent.change(find, { target: { value: "nginx" } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No service matches “nginx”.")).toBeInTheDocument();
  });

  it("SVC-17: with nothing listed, the page says so and what it lists", async () => {
    const m = servicesMachine();
    m.processes = m.processes.filter((p) => ![48345, 33438, 51002].includes(p.pid));
    const w = servicesWorld();
    w.environments = w.environments.filter((env) => env.id !== "env_remote");
    await mountServices(w, m);
    expect(await screen.findByText("No servers running in your environments.")).toBeVisible();
    expect(screen.getByText(/listening on a port inside an environment's folder/)).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("SVC-17, SVC-11: with nothing listed here, environments on other hosts still show as not checked", async () => {
    const m = servicesMachine();
    m.processes = m.processes.filter((p) => ![48345, 33438, 51002].includes(p.pid));
    await mountServices(servicesWorld(), m);
    expect(await screen.findByText("No servers running in your environments.")).toBeVisible();
    expect(table()).toHaveTextContent("Not checked: this environment is on another machine.");
    expect(table().querySelectorAll("[data-service-pid]")).toHaveLength(0);
  });

  it("SVC-11: when bb's own machine cannot be told, the page says no environment was checked, and lists them as not checked", async () => {
    await mountServices(servicesWorld({ localHostId: null }));
    expect(
      await screen.findByText(
        "Could not tell which machine bb runs on, so no environment was checked.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("No servers running in your environments.")).toBeNull();
    const notChecked = within(table())
      .getAllByRole("columnheader")
      .filter((th) => th.getAttribute("scope") === "colgroup");
    expect(notChecked).toHaveLength(4);
    expect(
      within(table()).getAllByText("Not checked: this environment is on another machine."),
    ).toHaveLength(4);
  });

  it("SVC-12: without lsof the page says detection is unavailable instead of an empty list", async () => {
    const m = servicesMachine();
    m.lsof = false;
    await mountServices(servicesWorld(), m);
    expect(
      await screen.findByText(
        "Service detection is unavailable on this machine: lsof was not found.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("No servers running in your environments.")).toBeNull();
  });

  it("SVC-5: selecting a row opens a drawer with its ports, program, PID, uptime, log file to copy, Open, Stop, and the log tail; another row switches it; × closes it", async () => {
    vi.setSystemTime(STARTED_AT + 2 * 3_600_000);
    const { slot } = await mountServices();
    await screen.findByRole("table", { name: "Services" });
    expect(screen.queryByRole("region", { name: "Log" })).toBeNull();
    fireEvent.click(row(33438));
    expect(row(33438)).toHaveAttribute("data-selected");
    await waitFor(() =>
      expect(drawer().querySelector("[data-log]")).toHaveTextContent(
        "database system is ready to accept connections",
      ),
    );
    const header = drawer().querySelector<HTMLElement>("[data-drawer-header]")!;
    expect(header).toHaveTextContent(":55400");
    expect(header).toHaveTextContent("postgres");
    expect(header).toHaveTextContent("PID 33438");
    expect(header).toHaveTextContent("Up 2h");
    const file = drawer().querySelector("[data-log-path]")!;
    expect(file).toHaveTextContent(/^pg\.log$/);
    expect(file).toHaveAttribute("title", "/Users/me/.agents/pg.log");
    expect(
      within(drawer()).getByRole("link", { name: "Open :55400 in a new tab" }),
    ).toHaveAttribute("href", "http://127.0.0.1:55400");
    expect(within(drawer()).getByRole("button", { name: "Stop" })).toBeInTheDocument();
    fireEvent.click(within(drawer()).getByRole("button", { name: "Copy log path" }));
    await waitFor(() =>
      expect(slot.inspection.experimental_clipboardWrites).toEqual([
        { text: "/Users/me/.agents/pg.log" },
      ]),
    );
    expect(drawer().querySelector("[data-log]")?.tagName).toBe("PRE");

    fireEvent.click(within(row(48345)).getAllByRole("cell")[3]!);
    await waitFor(() => expect(drawer()).toHaveTextContent("listening on :55401"));
    expect(screen.getAllByRole("region", { name: "Log" })).toHaveLength(1);
    expect(row(33438)).not.toHaveAttribute("data-selected");

    fireEvent.click(row(51002));
    expect(
      await within(drawer()).findByText(
        "This process has no log file: its standard output is not a file.",
      ),
    ).toBeVisible();

    fireEvent.click(within(drawer()).getByRole("button", { name: "Close log" }));
    expect(screen.queryByRole("region", { name: "Log" })).toBeNull();
  });

  it("SVC-5: the log is refreshed while shown and scrolled to the end", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { server } = await mountServices();
    await advance(0);
    fireEvent.click(row(33438));
    await advance(0);
    const pre = drawer().querySelector<HTMLElement>("[data-log]")!;
    Object.defineProperty(pre, "scrollHeight", { configurable: true, get: () => 900 });
    server.machine.files["/Users/me/.agents/pg.log"] += "LOG:  checkpoint starting\n";
    await advance(2_000);
    expect(pre).toHaveTextContent("checkpoint starting");
    expect(pre.scrollTop).toBe(900);
  });

  it("SVC-16: when the selected process is no longer listed, the drawer says it ended and keeps its log", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { server } = await mountServices();
    await advance(0);
    fireEvent.click(row(33438));
    await advance(0);
    expect(drawer()).toHaveTextContent("database system is ready");
    server.machine.processes = server.machine.processes.filter((p) => p.pid !== 33438);
    await advance(SERVICES_REFRESH_MS);
    expect(within(drawer()).getByRole("status")).toHaveTextContent("This process ended.");
    expect(drawer()).toHaveTextContent("database system is ready");
    expect(table().querySelector('[data-service-pid="33438"]')).toBeNull();
    fireEvent.click(within(drawer()).getByRole("button", { name: "Close log" }));
    expect(screen.queryByRole("region", { name: "Log" })).toBeNull();
  });

  it("SVC-6: each port is a link to http://127.0.0.1:<port> in a new tab; the drawer's Open does the same, with a menu for several ports", async () => {
    await mountServices();
    await screen.findByRole("table", { name: "Services" });
    const open = within(row(33438)).getByRole("link", { name: "Open :55400 in a new tab" });
    expect(open).toHaveAttribute("href", "http://127.0.0.1:55400");
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      within(row(51002))
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["http://127.0.0.1:5173", "http://127.0.0.1:24678"]);
    // Opening a port does not select the row.
    fireEvent.click(open);
    expect(row(33438)).not.toHaveAttribute("data-selected");

    fireEvent.click(row(51002));
    const menu = await openMenu(within(drawer()).getByRole("button", { name: "Open" }));
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => [item.textContent, item.getAttribute("href")])).toEqual([
      ["Open :5173", "http://127.0.0.1:5173"],
      ["Open :24678", "http://127.0.0.1:24678"],
    ]);
    expect(items[0]).toHaveAttribute("target", "_blank");
  });

  it("SVC-7: a row's ⋯ menu copies the PID, the command line, or a port, and offers Stop…", async () => {
    const { slot } = await mountServices();
    await screen.findByRole("table", { name: "Services" });
    const copyFrom = async (name: string) => {
      const menu = await rowMenu(51002);
      fireEvent.click(within(menu).getByRole("menuitem", { name }));
    };
    const menu = await rowMenu(51002);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Copy PID", "Copy command line", "Copy port :5173", "Copy port :24678", "Stop…"]);
    fireEvent.keyDown(menu, { key: "Escape" });
    await copyFrom("Copy PID");
    await copyFrom("Copy command line");
    await copyFrom("Copy port :24678");
    await waitFor(() =>
      expect(slot.inspection.experimental_clipboardWrites).toEqual([
        { text: "51002" },
        { text: "node node_modules/.bin/vite" },
        { text: "24678" },
      ]),
    );
    // Copying does not select the row.
    expect(row(51002)).not.toHaveAttribute("data-selected");
  });

  it("SVC-8, SVC-19: Stop asks first, saying how many processes it signals, then sends SIGTERM", async () => {
    const { server } = await mountServices();
    await screen.findByRole("table", { name: "Services" });
    await stopFromRow(48345);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Sends SIGTERM to 3 processes");
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "npm run dev",
      "npm exec tsx watch apps/api/src/main.ts",
      "/usr/local/bin/node apps/api/src/main.ts",
    ]);
    expect(server.kills).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.kills).toEqual([]);

    // From the drawer.
    fireEvent.click(row(33438));
    fireEvent.click(within(drawer()).getByRole("button", { name: "Stop" }));
    const again = await screen.findByRole("dialog");
    expect(again).toHaveTextContent("Sends SIGTERM to 1 process: PID 33438");
    fireEvent.click(within(again).getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(server.kills).toEqual([{ target: -33438, signal: "SIGTERM" }]));
    await waitFor(() => expect(table().querySelector('[data-service-pid="33438"]')).toBeNull());
  });

  it("SVC-19: when the group changed after the confirmation, Stop signals nothing and refreshes", async () => {
    const { server, rpc } = await mountServices();
    await screen.findByRole("table", { name: "Services" });
    await stopFromRow(48345);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Sends SIGTERM to 3 processes");
    server.machine.processes.push({ pid: 48373, pgid: 48263, command: "esbuild --service" });
    const before = listCalls(rpc);
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(listCalls(rpc)).toBeGreaterThan(before));
    expect(server.kills).toEqual([]);
  });

  it("SVC-8: a process that changed since the scan is not signalled; the page says so and refreshes", async () => {
    const { server, rpc } = await mountServices();
    await screen.findByRole("table", { name: "Services" });
    const before = listCalls(rpc);
    server.machine.processes.find((p) => p.pid === 33438)!.start = "Sun Oct 18 09:00:00 2026";
    await stopFromRow(33438);
    await waitFor(() => expect(listCalls(rpc)).toBeGreaterThan(before));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(server.kills).toEqual([]);
  });

  it("SVC-9: after Stop the row says Stopping…; still alive 5 seconds later, the row and drawer offer Force stop, which sends SIGKILL, even once its port is closed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const m = servicesMachine();
    m.processes.find((p) => p.pid === 33438)!.ignoresTerm = true;
    const { server } = await mountServices(servicesWorld(), m);
    await advance(0);
    fireEvent.click(row(33438));
    await advance(0);
    fireEvent.click(within(drawer()).getByRole("button", { name: "Stop" }));
    await advance(0);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Stop" }));
    await advance(0);
    expect(server.kills).toEqual([{ target: -33438, signal: "SIGTERM" }]);
    // Shutting down, it closed its port but still runs.
    server.machine.processes.find((p) => p.pid === 33438)!.ports = [];
    expect(within(row(33438)).getAllByRole("cell")[3]).toHaveTextContent("Stopping…");
    expect(within(row(33438)).queryByRole("button", { name: "Force stop" })).toBeNull();
    await advance(FORCE_STOP_AFTER_MS);
    expect(within(drawer()).getByRole("button", { name: "Force stop" })).toBeInTheDocument();
    expect(within(drawer()).queryByRole("button", { name: "Stop" })).toBeNull();
    fireEvent.click(within(row(33438)).getByRole("button", { name: "Force stop" }));
    await advance(0);
    expect(server.kills.at(-1)).toEqual({ target: -33438, signal: "SIGKILL" });
    await advance(0);
    expect(table().querySelector('[data-service-pid="33438"]')).toBeNull();
  });

  it("SVC-10: 5 seconds while the Services view shows, the count every 30 seconds otherwise, nothing while hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { rpc, slot } = await mountServices(servicesWorld(), servicesMachine(), {
      open: false,
    });
    await advance(0);
    expect(listCalls(rpc)).toBe(1);
    await advance(COUNT_REFRESH_MS - 1);
    expect(listCalls(rpc)).toBe(1);
    await advance(1);
    expect(listCalls(rpc)).toBe(2);
    // Showing Services scans at once, then every 5 s.
    fireEvent.click(servicesButton());
    await advance(0);
    expect(listCalls(rpc)).toBe(3);
    await advance(SERVICES_REFRESH_MS);
    expect(listCalls(rpc)).toBe(4);
    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(COUNT_REFRESH_MS * 2);
    expect(listCalls(rpc)).toBe(4);
    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(0);
    expect(listCalls(rpc)).toBe(5);
    // Back to the terminals: the count's 30 s again.
    fireEvent.click(servicesButton());
    await advance(SERVICES_REFRESH_MS * 2);
    expect(listCalls(rpc)).toBe(5);
    await advance(COUNT_REFRESH_MS);
    expect(listCalls(rpc)).toBe(6);
    // Leaving the page stops it.
    slot.lifecycle.unmount();
    await advance(COUNT_REFRESH_MS * 4);
    expect(listCalls(rpc)).toBe(6);
  });

  it("SVC-21: the URL carries no view nor row; the view opens with nothing selected, and switching or selecting adds no history entry", async () => {
    const { slot, page } = await mountServices();
    await screen.findByRole("table", { name: "Services" });
    expect(table().querySelector("[data-selected]")).toBeNull();
    expect(screen.queryByRole("region", { name: "Log" })).toBeNull();
    fireEvent.click(row(33438));
    fireEvent.click(row(51002));
    // Back and forth: the view opens anew, with nothing selected.
    fireEvent.click(servicesButton());
    fireEvent.click(servicesButton());
    expect(await screen.findByRole("table", { name: "Services" })).toBeInTheDocument();
    expect(table().querySelector("[data-selected]")).toBeNull();
    expect(page.subPath()).toBe("");
    expect(slot.inspection.navigateCalls).toEqual([]);
  });

  it("SVC-21: reloading shows the terminals", async () => {
    await mountServices();
    await screen.findByRole("table", { name: "Services" });
    cleanup();
    // A reload starts a new app, with a new SDK.
    await mountServices(servicesWorld(), servicesMachine(), { open: false });
    expect(servicesButton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Services" })).toBeNull();
  });
});
