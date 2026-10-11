// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAST_REFRESH_MS,
  HubStore,
  hubStoreFor,
  RECONCILE_WAIT_MS,
  SCAN_REFRESH_MS,
} from "../lib/hub-store";
import { ALL } from "../lib/route";
import { fakeSdk, terminal, thread, world } from "./fixtures/fake-bb";

let visibility: DocumentVisibilityState = "visible";
const detachers: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(async () => {
  for (const detach of detachers.splice(0)) detach();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

function open(w: ReturnType<typeof world>, environment: string) {
  const bb = fakeSdk(w);
  const store = new HubStore(bb.sdk, "proj_1");
  const detach = store.attach(environment, null);
  detachers.push(detach);
  return {
    ...bb,
    store,
    detach,
    ids: () => store.getView().rows.map((row) => row.terminal.id),
  };
}

const listCalls = (sdk: ReturnType<typeof fakeSdk>["sdk"], kind: string) =>
  sdk.terminals.list.mock.calls.filter(([args]) => args.scope.kind === kind);

describe("hub store", () => {
  it("LIST-8: refreshes every 5 seconds while the page is visible, and not while hidden", async () => {
    const w = world();
    const { sdk, store, ids } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual([]);

    w.terminals.push(terminal({ id: "term_late" }));
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(ids()).toEqual(["term_late"]);

    setVisibility("hidden");
    const calls = sdk.terminals.list.mock.calls.length;
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS * 4);
    expect(sdk.terminals.list.mock.calls.length).toBe(calls);

    w.terminals.push(terminal({ id: "term_hidden" }));
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toContain("term_hidden");
    expect(store.getView().running).toBe(2);
  });

  it("LIST-8: refreshes at once when bb signals a thread in the environment changed", async () => {
    const w = world({ threads: [thread({ id: "thr_1" })] });
    const { store, ids, emitThreadChanged } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    w.terminals.push(terminal({ id: "term_t", threadId: "thr_1" }));
    emitThreadChanged({ id: "thr_1", changes: ["terminals-changed"] });
    await vi.advanceTimersByTimeAsync(300);
    expect(ids()).toEqual(["term_t"]);
    expect(store.getView().sections[0]?.grouped.threads[0]?.thread.id).toBe("thr_1");
  });

  it("LIST-11: keeps an exited terminal's row with its exit code until dismissed", async () => {
    const w = world({ terminals: [terminal({ id: "term_build", title: "build" })] });
    const { store, ids } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(["term_build"]);

    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 1;
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    const row = store.getView().rows[0];
    expect(row?.terminal.id).toBe("term_build");
    expect(row?.terminal.status).toBe("exited");
    expect(row?.terminal.exitCode).toBe(1);

    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(ids()).toEqual(["term_build"]);
    store.dismiss("term_build");
    expect(ids()).toEqual([]);
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(ids()).toEqual([]);
  });

  it("LIST-11: keeps exited rows and dismissals across leaving the page and returning", async () => {
    const w = world({
      terminals: [terminal({ id: "term_build" }), terminal({ id: "term_old" })],
    });
    const { store, ids, detach } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    for (const session of w.terminals) session.status = "exited";
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(ids()).toEqual(["term_build", "term_old"]);
    store.dismiss("term_old");
    detach();
    await vi.advanceTimersByTimeAsync(60_000);

    detachers.push(store.attach("env_a", null));
    expect(ids()).toEqual(["term_build"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(["term_build"]);
    expect(store.getView().rows[0]?.terminal.status).toBe("exited");
  });

  it("LIST-7: reads each terminal's last 4 KB once when it first appears, then only from the view", async () => {
    const w = world({
      terminals: [terminal({ id: "term_dev" }), terminal({ id: "term_quiet" })],
      output: { term_dev: "VITE ready\n  ➜  Local:   http://localhost:5173/\n" },
    });
    const { sdk, store } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().hints.get("term_dev")?.label).toBe(":5173");
    expect(sdk.terminals.output).toHaveBeenCalledWith({ terminalId: "term_dev", tailBytes: 4096 });

    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS * 3);
    expect(sdk.terminals.output).toHaveBeenCalledTimes(2);

    store.pushOutput("term_dev", new TextEncoder().encode("restarting on http://127.0.0.1:5174\n"));
    expect(store.getView().hints.get("term_dev")?.label).toBe(":5174");
  });

  it("LIST-6: looks up each host's home directory once", async () => {
    const w = world({ terminals: [terminal({ id: "a" }), terminal({ id: "b" })] });
    const { sdk, store } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().homes.get("host_1")).toBe("/Users/me");
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(sdk.hosts.directory).toHaveBeenCalledTimes(1);
    expect(sdk.hosts.directory).toHaveBeenCalledWith({ hostId: "host_1" });
  });

  it("LIST-14: in All, lists environment terminals every 5 s, rescans threads every 30 s, and refreshes a signalled thread at once", async () => {
    const w = world({
      environments: [
        ...world().environments,
        {
          id: "env_b",
          projectId: "proj_1",
          name: "feature",
          branchName: null,
          path: "/Users/me/wt",
          hostId: "host_1",
          status: "ready",
        },
      ],
      threads: [thread({ id: "thr_1" }), thread({ id: "thr_2", environmentId: "env_b" })],
    });
    const { sdk, store, ids, emitThreadChanged } = open(w, ALL);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().sections.map((s) => s.environment.id)).toEqual(["env_a", "env_b"]);
    expect(listCalls(sdk, "thread")).toHaveLength(2);
    const envCalls = listCalls(sdk, "environment").length;

    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(listCalls(sdk, "environment").length).toBe(envCalls + 2);
    expect(listCalls(sdk, "thread")).toHaveLength(2);

    // A thread terminal started without a signal waits for the next scan.
    w.terminals.push(terminal({ id: "term_quiet", threadId: "thr_2", environmentId: "env_b" }));
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(ids()).not.toContain("term_quiet");
    await vi.advanceTimersByTimeAsync(SCAN_REFRESH_MS);
    expect(ids()).toContain("term_quiet");

    const scans = listCalls(sdk, "thread").length;
    w.terminals.push(terminal({ id: "term_signal", threadId: "thr_1" }));
    emitThreadChanged({ id: "thr_1", changes: ["terminals-changed"] });
    await vi.advanceTimersByTimeAsync(300);
    expect(ids()).toContain("term_signal");
    expect(listCalls(sdk, "thread").length).toBe(scans + 1);
    expect(sdk.threads.get).toHaveBeenCalledWith({ threadId: "thr_1" });
  });

  it("LIST-13: counts running terminals per environment section", async () => {
    const w = world({
      environments: [
        ...world().environments,
        {
          id: "env_b",
          projectId: "proj_1",
          name: null,
          branchName: "feature/x",
          path: "/Users/me/wt",
          hostId: "host_1",
          status: "ready",
        },
        {
          id: "env_gone",
          projectId: "proj_1",
          name: null,
          branchName: null,
          path: "/tmp/gone",
          hostId: "host_1",
          status: "destroyed",
        },
      ],
      threads: [thread({ id: "thr_b", environmentId: "env_b" })],
      terminals: [
        terminal({ id: "a1" }),
        terminal({ id: "a2" }),
        terminal({ id: "b1", threadId: "thr_b", environmentId: "env_b" }),
      ],
    });
    const { store } = open(w, ALL);
    await vi.advanceTimersByTimeAsync(0);
    const sections = store.getView().sections;
    expect(sections.map((s) => [s.environment.name, s.running])).toEqual([
      ["main", 2],
      ["feature/x", 1],
    ]);
    expect(store.getView().running).toBe(3);
  });

  it("LIST-1: a late answer to an older request never replaces a newer listing", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { sdk, ids } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    let release!: () => void;
    sdk.terminals.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ sessions: [terminal({ id: "late" })] });
        }),
    );
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(ids()).toEqual(["a1"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(["a1"]);
  });

  it("LIST-27: one store per project, kept for the session", () => {
    const bb = fakeSdk(world());
    const store = hubStoreFor(bb.sdk, "proj_1");
    expect(hubStoreFor(bb.sdk, "proj_1")).toBe(store);
    expect(hubStoreFor(bb.sdk, "proj_2")).not.toBe(store);
    expect(hubStoreFor(fakeSdk(world()).sdk, "proj_1")).not.toBe(store);
  });

  it("LIST-11: keeps the exited rows of a deleted thread under that thread", async () => {
    const w = world({
      threads: [thread({ id: "thr_gone", title: "Throwaway" })],
      terminals: [terminal({ id: "term_t", threadId: "thr_gone" })],
    });
    const { store } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    w.threads = [];
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = null;
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    const group = store.getView().sections[0]?.grouped.threads[0];
    expect(group?.thread.title).toBe("Throwaway");
    expect(group?.rows.map((row) => [row.terminal.id, row.terminal.status])).toEqual([
      ["term_t", "exited"],
    ]);
  });

  it("LIST-11: a vanished row stays in place until bb says it exited", async () => {
    const w = world({ terminals: [terminal({ id: "term_1" })] });
    const { sdk, store, ids } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    let answer!: () => void;
    const real = sdk.terminals.get.getMockImplementation();
    sdk.terminals.get.mockImplementationOnce(
      (args) =>
        new Promise((resolve) => {
          answer = () => resolve(real?.(args) as never);
        }),
    );
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 4;
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(ids()).toEqual(["term_1"]);
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().rows[0]?.terminal.exitCode).toBe(4);
  });

  it("LIST-13: an environment that cannot be listed shows its error and still counts as loaded", async () => {
    const w = world({
      environments: [
        ...world().environments,
        {
          id: "env_off",
          projectId: "proj_1",
          name: "offline box",
          branchName: null,
          path: "/srv/x",
          hostId: "host_2",
          status: "ready",
        },
      ],
    });
    const { sdk, store } = open(w, ALL);
    const real = sdk.terminals.list.getMockImplementation();
    sdk.terminals.list.mockImplementation(async (args) => {
      if (args.scope.kind === "environment" && args.scope.environmentId === "env_off") {
        throw new Error("host offline");
      }
      return real?.(args) as never;
    });
    await vi.advanceTimersByTimeAsync(0);
    const off = store.getView().sections.find((section) => section.environment.id === "env_off");
    expect(off?.loaded).toBe(true);
    expect(off?.error).toBe("host offline");
  });

  it("ACT-6: a terminal closed here does not come back from a refresh that started before the close", async () => {
    const w = world({ terminals: [terminal({ id: "term_1" })] });
    const { sdk, store, ids } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    let release!: () => void;
    sdk.terminals.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ sessions: [terminal({ id: "term_1" })] });
        }),
    );
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    await store.close("term_1");
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual([]);
    expect(store.getView().running).toBe(0);
  });

  it("LIST-8: keeps refreshing when React mounts the page twice (StrictMode)", async () => {
    const w = world();
    const { store, ids, detach } = open(w, "env_a");
    detach();
    detachers.push(store.attach("env_a", null));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().lastKnown).toBe(false);
    w.terminals.push(terminal({ id: "term_late" }));
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(ids()).toEqual(["term_late"]);
  });

  it("LIST-11: a failed exit check keeps the row and asks again on the next refresh", async () => {
    const w = world({ terminals: [terminal({ id: "term_1" })] });
    const { sdk, store, ids } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    sdk.terminals.get.mockRejectedValueOnce(new Error("network hiccup"));
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 7;
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(ids()).toEqual(["term_1"]);
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(store.getView().rows[0]?.terminal.exitCode).toBe(7);
  });

  it("LIST-17: shows the first scan's progress, and is complete only once it succeeds", async () => {
    const w = world({ threads: [thread({ id: "thr_1" }), thread({ id: "thr_2" })] });
    const bb = fakeSdk(w);
    const real = bb.sdk.terminals.list.getMockImplementation();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    bb.sdk.terminals.list.mockImplementation(async (args) => {
      if (args.scope.kind === "thread" && args.scope.threadId === "thr_2") await gate;
      return real?.(args) as never;
    });
    const store = new HubStore(bb.sdk, "proj_1");
    detachers.push(store.attach(ALL, null));
    expect(store.getView().scan).toEqual({ scanned: 0, total: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().scan).toEqual({ scanned: 1, total: 2 });
    expect(store.getView().complete).toBe(false);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().scan).toBeNull();
    expect(store.getView().complete).toBe(true);

    // Later rescans run quietly.
    await vi.advanceTimersByTimeAsync(SCAN_REFRESH_MS);
    expect(store.getView().scan).toBeNull();
  });

  it("LIST-17: a failed first scan shows its error, stays incomplete, and the next scan tries again", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const bb = fakeSdk(w);
    bb.sdk.threads.list.mockRejectedValueOnce(new Error("bb is restarting"));
    const store = new HubStore(bb.sdk, "proj_1");
    detachers.push(store.attach(ALL, null));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().error).toBe("bb is restarting");
    expect(store.getView().scan).toBeNull();
    expect(store.getView().complete).toBe(false);
    // Rows it already has stay.
    expect(store.getView().rows.map((row) => row.terminal.id)).toEqual(["a1"]);

    await vi.advanceTimersByTimeAsync(SCAN_REFRESH_MS);
    expect(store.getView().error).toBeNull();
    expect(store.getView().complete).toBe(true);
  });

  it("LIST-17: a failed environment list is not a finished scan", async () => {
    const bb = fakeSdk(world());
    bb.sdk.environments.list.mockRejectedValueOnce(new Error("no such project"));
    const store = new HubStore(bb.sdk, "proj_1");
    detachers.push(store.attach(ALL, null));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().error).toBe("no such project");
    expect(store.getView().complete).toBe(false);
    expect(bb.sdk.threads.list).not.toHaveBeenCalled();
  });

  it("LIST-17: with no threads, the list waits for every environment's own terminals", async () => {
    const bb = fakeSdk(world({ terminals: [terminal({ id: "a1" })] }));
    const real = bb.sdk.terminals.list.getMockImplementation();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    bb.sdk.terminals.list.mockImplementation(async (args) => {
      if (args.scope.kind === "environment") await gate;
      return real?.(args) as never;
    });
    const store = new HubStore(bb.sdk, "proj_1");
    detachers.push(store.attach(ALL, null));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().scan).toBeNull();
    expect(store.getView().complete).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().complete).toBe(true);
    expect(store.getView().rows.map((row) => row.terminal.id)).toEqual(["a1"]);
  });

  it("LIST-17: scans never overlap, so an old scan cannot move the progress", async () => {
    const w = world({ threads: [thread({ id: "thr_1" })] });
    const bb = fakeSdk(w);
    const real = bb.sdk.terminals.list.getMockImplementation();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    bb.sdk.terminals.list.mockImplementation(async (args) => {
      if (args.scope.kind === "thread") await gate;
      return real?.(args) as never;
    });
    const store = new HubStore(bb.sdk, "proj_1");
    detachers.push(store.attach(ALL, null));
    await vi.advanceTimersByTimeAsync(SCAN_REFRESH_MS * 2);
    expect(listCalls(bb.sdk, "thread")).toHaveLength(1);
    expect(store.getView().scan).toEqual({ scanned: 0, total: 1 });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().complete).toBe(true);
  });

  it("LIST-10: a single environment is complete once its listing succeeds", async () => {
    const bb = fakeSdk(world());
    const real = bb.sdk.terminals.list.getMockImplementation();
    bb.sdk.terminals.list.mockRejectedValueOnce(new Error("host offline"));
    const store = new HubStore(bb.sdk, "proj_1");
    detachers.push(store.attach("env_a", null));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().complete).toBe(false);
    bb.sdk.terminals.list.mockImplementation(real as never);
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(store.getView().complete).toBe(true);
  });

  it("LIST-10: switching from All to an environment while the first scan runs is not complete until its threads are listed", async () => {
    const w = world({
      threads: [thread({ id: "thr_1" })],
      terminals: [terminal({ id: "t1", threadId: "thr_1" })],
    });
    const bb = fakeSdk(w);
    const real = bb.sdk.terminals.list.getMockImplementation();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    bb.sdk.terminals.list.mockImplementation(async (args) => {
      if (args.scope.kind === "thread") await gate;
      return real?.(args) as never;
    });
    const store = new HubStore(bb.sdk, "proj_1");
    detachers.push(store.attach(ALL, null));
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    store.select("env_a", null);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().complete).toBe(false);
    expect(store.getView().sections[0]?.loaded).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().complete).toBe(true);
    expect(store.getView().rows.map((row) => row.terminal.id)).toEqual(["t1"]);
  });

  it("LIST-10: after a full scan in All, a picked environment is complete at once", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { store } = open(w, ALL);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().complete).toBe(true);
    store.select("env_a", null);
    expect(store.getView().complete).toBe(true);
    expect(store.getView().sections[0]?.loaded).toBe(true);
  });

  it("LIST-17: a rescan that finds a new environment lists its terminals at once", async () => {
    const w = world();
    const { store } = open(w, ALL);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().complete).toBe(true);
    w.environments.push({
      id: "env_new",
      projectId: "proj_1",
      name: "new",
      branchName: null,
      path: "/w/new",
      hostId: "host_1",
      status: "ready",
    });
    w.terminals.push(terminal({ id: "n1", environmentId: "env_new" }));
    // The 30 s scan lands between two 5 s ticks.
    await vi.advanceTimersByTimeAsync(SCAN_REFRESH_MS + 1);
    expect(store.getView().complete).toBe(true);
    expect(store.getView().rows.map((row) => row.terminal.id)).toEqual(["n1"]);
  });

  it("LIST-10: an environment newer than the last full scan is complete only once its threads are listed", async () => {
    const w = world();
    const bb = fakeSdk(w);
    const store = new HubStore(bb.sdk, "proj_1");
    detachers.push(store.attach(ALL, null));
    await vi.advanceTimersByTimeAsync(0);
    w.environments.push({
      id: "env_new",
      projectId: "proj_1",
      name: "new",
      branchName: null,
      path: "/w/new",
      hostId: "host_1",
      status: "ready",
    });
    w.threads.push(thread({ id: "thr_new", environmentId: "env_new" }));
    w.terminals.push(terminal({ id: "n1", threadId: "thr_new", environmentId: "env_new" }));
    // The rescan lists environments, then hangs on the thread list.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realThreads = bb.sdk.threads.list.getMockImplementation();
    bb.sdk.threads.list.mockImplementation(async (args) => {
      await gate;
      return realThreads?.(args) as never;
    });
    await vi.advanceTimersByTimeAsync(SCAN_REFRESH_MS + 1);
    store.select("env_new", null);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().complete).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().complete).toBe(true);
    expect(store.getView().rows.map((row) => row.terminal.id)).toEqual(["n1"]);
  });

  it("LIST-27, LIST-17: on return, shows the rows it had at once as last known, without scan progress, until confirmed", async () => {
    const w = world({
      threads: [thread({ id: "thr_1" })],
      terminals: [terminal({ id: "a1" }), terminal({ id: "t1", threadId: "thr_1" })],
    });
    const { sdk, store, ids, detach } = open(w, ALL);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().complete).toBe(true);
    expect(store.getView().lastKnown).toBe(false);
    detach();
    await vi.advanceTimersByTimeAsync(0);

    // Unconfirmed from the moment the page is left, before any return.
    expect(store.getView().complete).toBe(false);
    expect(store.getView().lastKnown).toBe(true);

    const real = sdk.threads.list.getMockImplementation();
    let release: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    sdk.threads.list.mockImplementation(async (args) => {
      await slow;
      return real?.(args) as never;
    });
    detachers.push(store.attach(ALL, null));
    expect(ids()).toEqual(["a1", "t1"]);
    await vi.advanceTimersByTimeAsync(0);
    let view = store.getView();
    expect(view.lastKnown).toBe(true);
    expect(view.freshness).toBe("updating");
    expect(view.complete).toBe(false);
    expect(view.scan).toBeNull();
    expect(view.sections[0]?.loaded).toBe(false);

    release();
    await vi.advanceTimersByTimeAsync(0);
    view = store.getView();
    expect(view.lastKnown).toBe(false);
    expect(view.freshness).toBe("live");
    expect(view.complete).toBe(true);
  });

  it("LIST-27: a refresh that fails after a return says it is reconnecting and stays last known", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { sdk, store, detach } = open(w, ALL);
    await vi.advanceTimersByTimeAsync(0);
    detach();
    await vi.advanceTimersByTimeAsync(0);
    sdk.threads.list.mockRejectedValue(new Error("bb is restarting"));
    detachers.push(store.attach(ALL, null));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().lastKnown).toBe(true);
    expect(store.getView().freshness).toBe("reconnecting");
    expect(store.getView().complete).toBe(false);
  });

  it("LIST-27: a scan from before leaving cannot confirm the list after a return", async () => {
    const w = world({ threads: [thread({ id: "thr_1" })] });
    const { sdk, store, detach } = open(w, ALL);
    await vi.advanceTimersByTimeAsync(0);
    const real = sdk.threads.list.getMockImplementation();
    const gates: (() => void)[] = [];
    sdk.threads.list.mockImplementation(async (args) => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return real?.(args) as never;
    });
    await vi.advanceTimersByTimeAsync(SCAN_REFRESH_MS);
    expect(gates).toHaveLength(1);
    detach();
    await vi.advanceTimersByTimeAsync(0);
    detachers.push(store.attach(ALL, null));
    await vi.advanceTimersByTimeAsync(0);
    // The return starts a scan of its own instead of waiting for the old one.
    expect(gates).toHaveLength(2);
    gates[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().lastKnown).toBe(true);
    for (const open of gates.splice(0)) open();
    await vi.advanceTimersByTimeAsync(0);
    for (const open of gates.splice(0)) open();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().lastKnown).toBe(false);
  });

  it("LIST-27, LIST-10: a single environment's rows are last known until it is listed again", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { sdk, store, detach } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    detach();
    await vi.advanceTimersByTimeAsync(0);
    w.terminals = [];
    const real = sdk.terminals.list.getMockImplementation();
    let release: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    sdk.terminals.list.mockImplementation(async (args) => {
      await slow;
      return real?.(args) as never;
    });
    detachers.push(store.attach("env_a", null));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().sections[0]?.loaded).toBe(false);
    expect(store.getView().complete).toBe(false);
    expect(store.getView().rows.map((row) => row.terminal.id)).toEqual(["a1"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().complete).toBe(true);
    expect(store.getView().sections[0]?.loaded).toBe(true);
  });

  it("LIST-28: on return, checks the selected terminal first, then its environment, then scans", async () => {
    const w = world({
      threads: [thread({ id: "thr_1" })],
      terminals: [terminal({ id: "a1" }), terminal({ id: "t1", threadId: "thr_1" })],
    });
    const { sdk, store, detach } = open(w, ALL);
    await vi.advanceTimersByTimeAsync(0);
    detach();
    await vi.advanceTimersByTimeAsync(0);
    sdk.terminals.get.mockClear();
    sdk.terminals.list.mockClear();
    sdk.threads.list.mockClear();
    detachers.push(store.attach(ALL, "t1"));
    await vi.advanceTimersByTimeAsync(0);
    const get = sdk.terminals.get.mock.invocationCallOrder[0] ?? Infinity;
    const own = sdk.terminals.list.mock.calls.findIndex(
      ([args]) => args.scope.kind === "environment",
    );
    const ownOrder = sdk.terminals.list.mock.invocationCallOrder[own] ?? -1;
    const scanOrder = sdk.threads.list.mock.invocationCallOrder[0] ?? -1;
    expect(sdk.terminals.get).toHaveBeenCalledWith({ terminalId: "t1" });
    expect(get).toBeLessThan(ownOrder);
    expect(ownOrder).toBeLessThan(scanOrder);
  });

  it("LIST-28: on return, an exited selection keeps its row as exited", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { store, detach } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    detach();
    await vi.advanceTimersByTimeAsync(0);
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 2;
    detachers.push(store.attach("env_a", "a1"));
    await vi.advanceTimersByTimeAsync(0);
    const row = store.getView().rows[0];
    expect(row?.terminal.id).toBe("a1");
    expect(row?.terminal.exitCode).toBe(2);
  });

  it("LIST-28, NAV-5: on return, a selection bb no longer has is gone for good", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { store, detach } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    detach();
    await vi.advanceTimersByTimeAsync(0);
    w.terminals = [];
    detachers.push(store.attach("env_a", "a1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().vanished.has("a1")).toBe(true);
    expect(store.getView().rows).toEqual([]);
  });

  it("LIST-28: on return, a selection that cannot be reached keeps its row", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { sdk, store, detach } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    detach();
    await vi.advanceTimersByTimeAsync(0);
    sdk.terminals.get.mockRejectedValueOnce(new Error("host offline"));
    sdk.terminals.list.mockRejectedValue(new Error("host offline"));
    detachers.push(store.attach("env_a", "a1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().rows.map((row) => row.terminal.id)).toEqual(["a1"]);
    expect(store.getView().freshness).toBe("reconnecting");
  });

  it("VIEW-7: the view's exit marks the row exited at once, with its code", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { sdk, store } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    sdk.terminals.get.mockClear();
    store.noteEnded("a1", "exited", 4);
    const row = store.getView().rows[0];
    expect(row?.terminal.status).toBe("exited");
    expect(row?.terminal.exitCode).toBe(4);
    expect(store.getView().running).toBe(0);
    expect(sdk.terminals.get).not.toHaveBeenCalled();
  });

  it("ACT-5: refresh reports whether every part of it succeeded", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { sdk, store } = open(w, ALL);
    await vi.advanceTimersByTimeAsync(0);
    await expect(store.refresh(ALL)).resolves.toBe(true);
    sdk.threads.list.mockRejectedValueOnce(new Error("bb is restarting"));
    await expect(store.refresh(ALL)).resolves.toBe(false);
    sdk.terminals.list.mockRejectedValueOnce(new Error("host offline"));
    await expect(store.refresh("env_a")).resolves.toBe(false);
  });

  it("LIST-11, VIEW-7: an exit seen by the view is not undone by an older answer that said running", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { sdk, store, detach } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    detach();
    await vi.advanceTimersByTimeAsync(0);
    const real = sdk.terminals.get.getMockImplementation();
    let release: () => void = () => {};
    sdk.terminals.get.mockImplementationOnce(async (args) => {
      const answer = await real?.(args);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return answer as never;
    });
    detachers.push(store.attach("env_a", "a1"));
    await vi.advanceTimersByTimeAsync(0);
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 3;
    store.noteEnded("a1", "exited", 3);
    release();
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    const row = store.getView().rows[0];
    expect(row?.terminal.id).toBe("a1");
    expect(row?.terminal.exitCode).toBe(3);
  });

  it("LIST-11: renaming an exited row keeps it as an exited row", async () => {
    const w = world({ terminals: [terminal({ id: "a1", title: "old" })] });
    const { store, ids } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    const session = w.terminals[0];
    if (!session) throw new Error("fixture");
    session.status = "exited";
    session.exitCode = 1;
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    store.upsert({ ...session, title: "renamed" });
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS * 2);
    expect(ids()).toEqual(["a1"]);
    expect(store.getView().rows[0]?.terminal.title).toBe("renamed");
  });

  it("LIST-28: a selection that cannot be reached on return leaves no error behind once the list is confirmed", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { sdk, store, detach } = open(w, "env_a");
    await vi.advanceTimersByTimeAsync(0);
    detach();
    await vi.advanceTimersByTimeAsync(0);
    sdk.terminals.get.mockRejectedValueOnce(new Error("blip"));
    detachers.push(store.attach("env_a", "a1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getView().error).toBeNull();
    expect(store.getView().freshness).toBe("live");
  });

  it("LIST-28: a check of the selection that never answers does not hold up the rest", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { sdk, store, detach } = open(w, ALL);
    await vi.advanceTimersByTimeAsync(0);
    detach();
    await vi.advanceTimersByTimeAsync(0);
    sdk.terminals.get.mockImplementationOnce(() => new Promise(() => {}));
    sdk.threads.list.mockClear();
    detachers.push(store.attach(ALL, "a1"));
    await vi.advanceTimersByTimeAsync(RECONCILE_WAIT_MS);
    expect(sdk.threads.list).toHaveBeenCalled();
    expect(store.getView().lastKnown).toBe(false);
  });

  it("LIST-28: a return while the tab is hidden waits until it is shown, then checks the selection first", async () => {
    const w = world({ terminals: [terminal({ id: "a1" })] });
    const { sdk, store, detach } = open(w, ALL);
    await vi.advanceTimersByTimeAsync(0);
    detach();
    await vi.advanceTimersByTimeAsync(0);
    setVisibility("hidden");
    sdk.terminals.get.mockClear();
    sdk.threads.list.mockClear();
    detachers.push(store.attach(ALL, "a1"));
    await vi.advanceTimersByTimeAsync(FAST_REFRESH_MS);
    expect(sdk.terminals.get).not.toHaveBeenCalled();
    expect(sdk.threads.list).not.toHaveBeenCalled();
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.terminals.get.mock.invocationCallOrder[0]).toBeLessThan(
      sdk.threads.list.mock.invocationCallOrder[0] ?? -1,
    );
  });
});
