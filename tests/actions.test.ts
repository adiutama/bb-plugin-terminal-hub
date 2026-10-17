import { describe, expect, it, vi } from "vitest";
import {
  CloseFailedError,
  closeAll,
  closeTerminal,
  needsConfirmation,
  nextSelection,
  renameTerminal,
  restartTerminal,
  settledTargets,
} from "../lib/actions";
import { type HubRow, toHubThread } from "../lib/inventory";
import { fakeSdk, terminal, thread, world } from "./fixtures/fake-bb";

function row(
  overrides: Parameters<typeof terminal>[0],
  owner?: Parameters<typeof thread>[0],
): HubRow {
  const hubThread = owner ? toHubThread(thread(owner)) : null;
  const session = terminal({ threadId: owner?.id ?? null, ...overrides });
  return {
    terminal: session,
    thread: hubThread,
    stale: hubThread !== null && hubThread.state !== "active",
  };
}

describe("actions", () => {
  it("ACT-2: renames through the SDK so the title changes everywhere", async () => {
    const w = world({ terminals: [terminal({ id: "t1", title: "zsh" })] });
    const { sdk } = fakeSdk(w);
    const renamed = await renameTerminal(sdk, "t1", "  dev server  ");
    expect(sdk.terminals.rename).toHaveBeenCalledWith({ terminalId: "t1", title: "dev server" });
    expect(renamed.title).toBe("dev server");
  });

  it("ACT-3: restarts with bb's restart, which starts a new shell in the same scope", async () => {
    const w = world({ terminals: [terminal({ id: "t1" })] });
    const { sdk } = fakeSdk(w);
    await restartTerminal(sdk, "t1");
    expect(sdk.terminals.restart).toHaveBeenCalledWith({ terminalId: "t1" });
    expect(sdk.terminals.create).not.toHaveBeenCalled();
  });

  it("ACT-4: asks before closing thread terminals, never for environment terminals", () => {
    expect(needsConfirmation(row({ id: "env" }))).toBe(false);
    expect(needsConfirmation(row({ id: "thr" }, { id: "thr_1" }))).toBe(true);
  });

  it("ACT-5: targets every running thread terminal whose thread is not active, archived included", () => {
    const rows = [
      row({ id: "env" }),
      row({ id: "active" }, { id: "thr_a", status: "active" }),
      row({ id: "idle" }, { id: "thr_i", status: "idle" }),
      row({ id: "error" }, { id: "thr_e", status: "error" }),
      row({ id: "archived" }, { id: "thr_x", archivedAt: 1 }),
      row({ id: "exited", status: "exited", exitCode: 0 }, { id: "thr_i2", status: "idle" }),
    ];
    expect(settledTargets(rows).map((r) => r.terminal.id)).toEqual(["idle", "error", "archived"]);
  });

  it("ACT-5: closes each target and reports the ones that failed", async () => {
    const w = world({
      terminals: [
        terminal({ id: "a", threadId: "thr_1" }),
        terminal({ id: "b", threadId: "thr_1" }),
      ],
    });
    const { sdk } = fakeSdk(w);
    sdk.terminals.close.mockImplementationOnce(async () => {
      throw new Error("host offline");
    });
    const result = await closeAll(sdk, [
      row({ id: "a" }, { id: "thr_1" }),
      row({ id: "b" }, { id: "thr_1" }),
    ]);
    expect(result.closed).toEqual(["b"]);
    expect(result.failed.map((f) => [f.row.terminal.id, f.message])).toEqual([
      ["a", "host offline"],
    ]);
  });

  it("ACT-5: checks each confirmed terminal again and leaves the ones no longer stale", async () => {
    const w = world({
      threads: [thread({ id: "thr_idle" }), thread({ id: "thr_busy", status: "active" })],
      terminals: [
        terminal({ id: "still", threadId: "thr_idle" }),
        terminal({ id: "exited", threadId: "thr_idle", status: "exited", exitCode: 0 }),
        terminal({ id: "woke", threadId: "thr_busy" }),
        terminal({ id: "unknown", threadId: "thr_idle" }),
      ],
    });
    const { sdk } = fakeSdk(w);
    const real = sdk.terminals.get.getMockImplementation();
    sdk.terminals.get.mockImplementation(async (args) => {
      if (args.terminalId === "unknown") throw new Error("host offline");
      return real?.(args) as never;
    });
    const result = await closeAll(sdk, [
      row({ id: "still" }, { id: "thr_idle" }),
      row({ id: "exited" }, { id: "thr_idle" }),
      row({ id: "woke" }, { id: "thr_busy" }),
      row({ id: "gone" }, { id: "thr_idle" }),
      row({ id: "unknown" }, { id: "thr_idle" }),
    ]);
    expect(result.closed).toEqual(["still"]);
    expect(result.skipped.map((r) => r.terminal.id).sort()).toEqual(["exited", "gone", "woke"]);
    expect(result.failed.map((f) => [f.row.terminal.id, f.message])).toEqual([
      ["unknown", "host offline"],
    ]);
    expect(sdk.terminals.close).toHaveBeenCalledTimes(1);
    // Each running target's thread is asked after its terminal, right before closing.
    expect(sdk.threads.get).toHaveBeenCalledTimes(2);
  });

  it("ACT-6: closes in force mode and fails when the terminal is still running", async () => {
    const w = world({ terminals: [terminal({ id: "t1", title: "dev" })] });
    const { sdk } = fakeSdk(w);
    await closeTerminal(sdk, "t1");
    expect(sdk.terminals.close).toHaveBeenCalledWith({ terminalId: "t1", mode: "force" });

    const stubborn = {
      terminals: {
        ...sdk.terminals,
        close: vi.fn(async () => terminal({ id: "t2", title: "stubborn", status: "running" })),
      },
    };
    await expect(closeTerminal(stubborn, "t2")).rejects.toBeInstanceOf(CloseFailedError);
  });

  it("ACT-7: moves the selection to the tab on the right, else the left, else to nothing", () => {
    expect(nextSelection(["a", "b", "c"], "a")).toBe("b");
    expect(nextSelection(["a", "b", "c"], "b")).toBe("c");
    expect(nextSelection(["a", "b", "c"], "c")).toBe("b");
    expect(nextSelection(["a"], "a")).toBeNull();
    expect(nextSelection(["a"], "x")).toBeNull();
  });
});
