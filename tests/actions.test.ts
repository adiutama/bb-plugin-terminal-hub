import { describe, expect, it, vi } from "vitest";
import {
  CloseFailedError,
  closeTerminal,
  needsConfirmation,
  nextSelection,
  renameTerminal,
  restartTerminal,
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
