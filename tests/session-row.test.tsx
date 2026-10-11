// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
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
  it("LIST-5: leads with a green dot when running, a ring when exited, red unless the code is 0", () => {
    show({ terminal: terminal({ id: "a", title: "dev" }), thread: null, stale: false });
    const running = screen.getByRole("img", { name: "Running" });
    expect(running).toHaveAttribute("data-status", "running");
    expect(running).toHaveClass("bg-emerald-500");
    expect(running.closest("button")?.firstElementChild).toBe(running);
    cleanup();
    show({
      terminal: terminal({ id: "b", title: "build", status: "exited", exitCode: 1 }),
      thread: null,
      stale: false,
    });
    const failed = screen.getByRole("img", { name: "Exited with code 1" });
    expect(failed).toHaveAttribute("data-status", "failed");
    expect(failed).toHaveClass("border-red-500");
    expect(screen.getByText("exit 1")).toBeInTheDocument();
    cleanup();
    show({
      terminal: terminal({ id: "c", title: "lint", status: "exited", exitCode: 0 }),
      thread: null,
      stale: false,
    });
    const clean = screen.getByRole("img", { name: "Exited with code 0" });
    expect(clean).toHaveAttribute("data-status", "exited");
    expect(clean).not.toHaveClass("border-red-500");
    expect(screen.getByText("exit 0")).toBeInTheDocument();
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

  it("LIST-4, LIST-5: marks a stale row with an amber dot and warning, not a background, and says how long ago its thread stopped", () => {
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
    const line = screen.getByText("Fix flaky tests").parentElement;
    expect(line).toHaveTextContent("Fix flaky tests· idle 2h ago");
    expect(line).toHaveClass("text-amber-700");
    const dot = screen.getByRole("img", { name: "Running" });
    expect(dot).toHaveAttribute("data-status", "stale");
    expect(dot).toHaveClass("bg-amber-500");
    const row = screen.getByText("pnpm test").closest("li");
    expect(row).toHaveAttribute("data-stale");
    expect(row?.className).not.toMatch(/bg-amber/);
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

  it("LIST-24: row actions show on hover, focus, an open menu, or selection, keep their space, and stay tabbable", () => {
    show({
      terminal: terminal({ id: "b", title: "build", status: "exited", exitCode: 0 }),
      thread: null,
      stale: false,
    });
    const actions = screen.getByRole("button", { name: "Actions for build" }).parentElement;
    if (!actions) throw new Error("no actions");
    expect(actions).toHaveAttribute("data-row-actions");
    // Hidden by opacity only: never display:none, so nothing moves when shown.
    expect(actions).toHaveClass(
      "opacity-0",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100",
      "group-has-[[data-state=open]]:opacity-100",
      "pointer-coarse:opacity-100",
    );
    expect(actions.className).not.toMatch(/(^|\s)(hidden|invisible)(\s|$)/);
    for (const button of within(actions).getAllByRole("button")) {
      expect(button).not.toHaveAttribute("tabindex", "-1");
      expect(button).toHaveClass("pointer-coarse:size-9");
    }
    cleanup();
    show(
      {
        terminal: terminal({ id: "c", title: "dev" }),
        thread: null,
        stale: false,
      },
      { selected: true },
    );
    expect(screen.getByRole("button", { name: "Actions for dev" }).parentElement).not.toHaveClass(
      "opacity-0",
    );
  });
});
