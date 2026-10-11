import { describe, expect, it } from "vitest";
import {
  environmentOf,
  menuEnvironments,
  splitSections,
  summarize,
  visibleOrder,
} from "../lib/all-view";
import type { EnvironmentInfo, Section } from "../lib/hub-store";
import { groupEnvironment, type TerminalSession } from "../lib/inventory";
import { terminal, thread } from "./fixtures/fake-bb";

function env(id: string): EnvironmentInfo {
  return { id, name: id, path: `/w/${id}`, hostId: "host_1" };
}

function section(
  id: string,
  terminals: TerminalSession[] = [],
  extra: Partial<Section> = {},
): Section {
  const owners = [thread({ id: `thr_${id}`, environmentId: id, status: "idle" })];
  const grouped = groupEnvironment({
    environmentTerminals: terminals.filter((t) => t.threadId === null),
    threads: owners,
    threadTerminals: new Map([[`thr_${id}`, terminals.filter((t) => t.threadId !== null)]]),
  });
  return { environment: env(id), grouped, running: 0, loaded: true, error: null, ...extra };
}

describe("all view", () => {
  it("LIST-13: forty empty environments all go behind the disclosure", () => {
    const sections = Array.from({ length: 40 }, (_, i) => section(`env_${i}`));
    const { shown, empty } = splitSections(sections, null);
    expect(shown).toEqual([]);
    expect(empty).toHaveLength(40);
  });

  it("LIST-13: running, exited, failed, and selected environments keep a section, in BB's order", () => {
    const sections = [
      section("idle"),
      section("exited", [terminal({ id: "x", status: "exited", exitCode: 1 })]),
      section("failed", [], { error: "host offline" }),
      section("selected"),
      section("running", [terminal({ id: "r" })]),
    ];
    const { shown, empty } = splitSections(sections, "selected");
    expect(shown.map((s) => s.environment.id)).toEqual(["exited", "failed", "selected", "running"]);
    expect(empty.map((s) => s.environment.id)).toEqual(["idle"]);
  });

  it("LIST-9: finds the environment of a listed terminal, thread terminals included", () => {
    const sections = [
      section("a", [terminal({ id: "t_a" })]),
      section("b", [terminal({ id: "t_b", threadId: "thr_b", environmentId: null })]),
    ];
    expect(environmentOf(sections, "t_b")).toBe("b");
    expect(environmentOf(sections, "nope")).toBeNull();
    expect(environmentOf(sections, null)).toBeNull();
  });

  it("LIST-9: the menu puts the selected environment first, then BB's order", () => {
    const envs = [env("a"), env("b"), env("c")];
    expect(menuEnvironments(envs, "b")).toEqual({ first: env("b"), rest: [env("a"), env("c")] });
    expect(menuEnvironments(envs, null)).toEqual({ first: null, rest: envs });
  });

  it("ACT-7: a collapsed section offers only the selected terminal as an anchor", () => {
    const shown = [
      section("a", [terminal({ id: "a1" })]),
      section("b", [terminal({ id: "b1" }), terminal({ id: "b2" })]),
      section("c", [terminal({ id: "c1" })]),
    ];
    expect(visibleOrder(shown, new Set(["b"]), "a1")).toEqual(["a1", "c1"]);
    expect(visibleOrder(shown, new Set(["b"]), "b1")).toEqual(["a1", "b1", "c1"]);
    expect(visibleOrder(shown, new Set(), null)).toEqual(["a1", "b1", "b2", "c1"]);
  });

  it("LIST-16: counts running terminals, servers among them, and stale ones", () => {
    const rows = [
      section("a", [
        terminal({ id: "web" }),
        terminal({ id: "old", status: "exited", exitCode: 0 }),
        terminal({ id: "left", threadId: "thr_a" }),
      ]),
    ].flatMap((s) => [...s.grouped.environment, ...s.grouped.threads.flatMap((g) => g.rows)]);
    const hints = new Map([
      ["web", { url: "http://localhost:3000", label: ":3000" }],
      ["old", { url: "http://localhost:4000", label: ":4000" }],
    ]);
    expect(summarize(rows, hints)).toEqual({ running: 2, servers: 1, stale: 1 });
  });
});
