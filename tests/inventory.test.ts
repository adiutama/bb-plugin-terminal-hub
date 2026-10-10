import { describe, expect, it } from "vitest";
import {
  groupEnvironment,
  listAllThreads,
  loadEnvironment,
  mapLimited,
  orderedRows,
  threadState,
  toHubThread,
} from "../lib/inventory";
import { fakeSdk, terminal, thread, world } from "./fixtures/fake-bb";

describe("session list inventory", () => {
  it("LIST-1: lists the environment's own terminals plus every thread's, archived threads included", async () => {
    const w = world({
      threads: [
        thread({ id: "thr_live" }),
        thread({ id: "thr_archived", archivedAt: 5_000 }),
        thread({ id: "thr_elsewhere", environmentId: "env_b" }),
      ],
      terminals: [
        terminal({ id: "term_env" }),
        terminal({ id: "term_live", threadId: "thr_live" }),
        terminal({ id: "term_archived", threadId: "thr_archived" }),
        terminal({ id: "term_elsewhere", threadId: "thr_elsewhere", environmentId: "env_b" }),
        terminal({ id: "term_other_env", environmentId: "env_b" }),
      ],
    });
    const { sdk } = fakeSdk(w);
    const snapshot = await loadEnvironment(sdk, "env_a");
    const ids = orderedRows(groupEnvironment(snapshot)).map((row) => row.terminal.id);
    expect(ids.sort()).toEqual(["term_archived", "term_env", "term_live"]);
    expect(sdk.threads.list).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: "env_a", archived: true }),
    );
  });

  it("LIST-1: pages through every thread, not just the first page", async () => {
    const threads = Array.from({ length: 450 }, (_, i) => thread({ id: `thr_${i}` }));
    const { sdk } = fakeSdk(world({ threads }));
    const all = await listAllThreads(sdk, { environmentId: "env_a" });
    expect(all).toHaveLength(450);
  });

  it("LIST-1: scans thread terminals with bounded concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimited(
      Array.from({ length: 30 }, (_, i) => i),
      6,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
      },
    );
    expect(peak).toBe(6);
  });

  it("LIST-2: puts environment-scoped terminals under Environment and thread terminals under From threads", () => {
    const grouped = groupEnvironment({
      environmentTerminals: [terminal({ id: "term_env" })],
      threads: [thread({ id: "thr_1" })],
      threadTerminals: new Map([["thr_1", [terminal({ id: "term_t", threadId: "thr_1" })]]]),
    });
    expect(grouped.environment.map((row) => row.terminal.id)).toEqual(["term_env"]);
    expect(grouped.environment[0]?.thread).toBeNull();
    expect(grouped.threads.flatMap((g) => g.rows.map((row) => row.terminal.id))).toEqual([
      "term_t",
    ]);
  });

  it("LIST-3: gives each thread row the thread's title and state: active, idle, error, or archived", () => {
    expect(threadState(thread({ id: "a", status: "active" }))).toBe("active");
    expect(threadState(thread({ id: "b", status: "starting" }))).toBe("active");
    expect(threadState(thread({ id: "c", status: "stopping" }))).toBe("active");
    expect(threadState(thread({ id: "d", status: "idle" }))).toBe("idle");
    // pending: never ran, no session, so no turn is running.
    expect(threadState(thread({ id: "e", status: "pending" }))).toBe("idle");
    expect(threadState(thread({ id: "f", status: "error" }))).toBe("error");
    expect(threadState(thread({ id: "g", status: "active", archivedAt: 1 }))).toBe("archived");
    expect(toHubThread(thread({ id: "h", title: "Fix flaky tests" })).title).toBe(
      "Fix flaky tests",
    );
    expect(toHubThread(thread({ id: "i", title: null, titleFallback: "Fallback" })).title).toBe(
      "Fallback",
    );
  });

  it("LIST-4: marks running terminals of inactive threads stale, since archivedAt or latestAttentionAt", () => {
    const grouped = groupEnvironment({
      environmentTerminals: [],
      threads: [
        thread({ id: "thr_active", status: "active", latestAttentionAt: 9_000 }),
        thread({ id: "thr_idle", status: "idle", latestAttentionAt: 7_000 }),
        thread({ id: "thr_archived", archivedAt: 8_000, latestAttentionAt: 6_000 }),
      ],
      threadTerminals: new Map([
        ["thr_active", [terminal({ id: "a", threadId: "thr_active" })]],
        [
          "thr_idle",
          [
            terminal({ id: "b", threadId: "thr_idle" }),
            terminal({ id: "b_exited", threadId: "thr_idle", status: "exited", exitCode: 1 }),
          ],
        ],
        ["thr_archived", [terminal({ id: "c", threadId: "thr_archived" })]],
      ]),
    });
    const rows = new Map(orderedRows(grouped).map((row) => [row.terminal.id, row]));
    expect(rows.get("a")?.stale).toBe(false);
    expect(rows.get("b")?.stale).toBe(true);
    expect(rows.get("b_exited")?.stale).toBe(false);
    expect(rows.get("c")?.stale).toBe(true);
    expect(rows.get("b")?.thread?.inactiveSince).toBe(7_000);
    expect(rows.get("c")?.thread?.inactiveSince).toBe(8_000);
    expect(rows.get("a")?.thread?.inactiveSince).toBeNull();
  });

  it("LIST-12: orders Environment by creation and threads by most recent activity, each thread's terminals by creation", () => {
    const grouped = groupEnvironment({
      environmentTerminals: [
        terminal({ id: "env_new", createdAt: 30 }),
        terminal({ id: "env_old", createdAt: 10 }),
      ],
      threads: [
        thread({ id: "thr_quiet", latestAttentionAt: 100 }),
        thread({ id: "thr_busy", latestAttentionAt: 500 }),
      ],
      threadTerminals: new Map([
        ["thr_quiet", [terminal({ id: "q1", threadId: "thr_quiet", createdAt: 5 })]],
        [
          "thr_busy",
          [
            terminal({ id: "b2", threadId: "thr_busy", createdAt: 20 }),
            terminal({ id: "b1", threadId: "thr_busy", createdAt: 15 }),
          ],
        ],
      ]),
    });
    expect(grouped.environment.map((row) => row.terminal.id)).toEqual(["env_old", "env_new"]);
    expect(grouped.threads.map((group) => group.thread.id)).toEqual(["thr_busy", "thr_quiet"]);
    expect(grouped.threads[0]?.rows.map((row) => row.terminal.id)).toEqual(["b1", "b2"]);
  });
});
