// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type RowActions, SessionRow } from "../components/session-row";
import { type HubRow, toHubThread } from "../lib/inventory";
import { terminal, thread } from "./fixtures/fake-bb";

afterEach(cleanup);

const HOUR = 3_600_000;

function actions(): RowActions {
  return {
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onRestart: vi.fn(),
    onClose: vi.fn(),
    onDismiss: vi.fn(),
  };
}

function show(row: HubRow, extra: Partial<Parameters<typeof SessionRow>[0]> = {}) {
  const handlers = actions();
  renderSlot(
    { component: SessionRow },
    {
      row,
      selected: false,
      hint: undefined,
      home: "/Users/me",
      now: 10 * HOUR,
      actions: handlers,
      ...extra,
    },
  );
  return handlers;
}

describe("session row", () => {
  it("LIST-5: shows a running dot, or that the terminal exited with its code", () => {
    show({ terminal: terminal({ id: "a", title: "dev" }), thread: null, stale: false });
    expect(screen.getByRole("img", { name: "Running" })).toBeInTheDocument();
    cleanup();
    show({
      terminal: terminal({ id: "b", title: "build", status: "exited", exitCode: 1 }),
      thread: null,
      stale: false,
    });
    expect(screen.getByRole("img", { name: "Exited with code 1" })).toBeInTheDocument();
    expect(screen.getByText("exit 1")).toBeInTheDocument();
  });

  it("LIST-6: shows the title and the starting directory with home as ~", () => {
    show({
      terminal: terminal({ id: "a", title: "dev server", initialCwd: "/Users/me/repo" }),
      thread: null,
      stale: false,
    });
    expect(screen.getByText("dev server")).toBeInTheDocument();
    expect(screen.getByText("~/repo")).toBeInTheDocument();
  });

  it("LIST-7: shows the server hint", () => {
    show(
      { terminal: terminal({ id: "a", title: "dev" }), thread: null, stale: false },
      { hint: { url: "http://localhost:3000/", label: ":3000" } },
    );
    expect(screen.getByText(":3000")).toHaveAttribute("title", "http://localhost:3000/");
  });

  it("LIST-4: highlights a stale row and says how long ago its thread stopped", () => {
    const owner = toHubThread(
      thread({
        id: "thr_1",
        title: "Fix flaky tests",
        status: "idle",
        latestAttentionAt: 8 * HOUR,
      }),
    );
    show({
      terminal: terminal({ id: "a", title: "pnpm test", threadId: "thr_1" }),
      thread: owner,
      stale: true,
    });
    expect(screen.getByText("thread idle 2h")).toBeInTheDocument();
    expect(screen.getByText("pnpm test").closest("li")).toHaveAttribute("data-stale");
  });

  it("LIST-11: an exited row can be dismissed", () => {
    const handlers = show({
      terminal: terminal({ id: "b", title: "build", status: "exited", exitCode: 0 }),
      thread: null,
      stale: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss build" }));
    expect(handlers.onDismiss).toHaveBeenCalled();
  });
});
