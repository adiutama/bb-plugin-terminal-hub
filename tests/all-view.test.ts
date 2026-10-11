import { describe, expect, it } from "vitest";
import {
  environmentOf,
  type FilterContext,
  filterAll,
  filteredOrder,
  filterSection,
  filterWords,
  menuEnvironments,
  rowMatches,
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

  describe("filter", () => {
    const filterBy = (text: string): FilterContext => ({
      words: filterWords(text),
      hints: new Map([["web", { label: ":3000", url: "http://localhost:3000/" }]]),
      homes: new Map([["host_1", "/Users/me"]]),
    });
    const kai = () =>
      section("kai-flaky", [
        terminal({ id: "web", title: "dev server", initialCwd: "/Users/me/kai" }),
        terminal({ id: "test", title: "pnpm test", threadId: "thr_kai-flaky" }),
      ]);
    const ids = (s: Section) =>
      [...s.grouped.environment, ...s.grouped.threads.flatMap((g) => g.rows)].map(
        (row) => row.terminal.id,
      );

    it("LIST-18: blank text is no filter", () => {
      expect(filterWords("   ")).toEqual([]);
      expect(filterWords("  Dev   SERVER ")).toEqual(["dev", "server"]);
    });

    it("LIST-18: matches title, environment, thread, directory as shown or in full, and server hint, ignoring case", () => {
      const s = kai();
      const [web] = s.grouped.environment;
      const [test] = s.grouped.threads[0]?.rows ?? [];
      if (!web || !test) throw new Error("fixture");
      const match = (row: typeof web, text: string) =>
        rowMatches(row, s.environment.name, filterBy(text));
      expect(match(web, "DEV")).toBe(true);
      expect(match(web, "kai-flaky")).toBe(true);
      expect(match(test, "thread thr_kai")).toBe(true);
      expect(match(web, "~/kai")).toBe(true);
      expect(match(web, "/users/me/kai")).toBe(true);
      expect(match(web, "3000")).toBe(true);
      expect(match(web, "localhost:3000")).toBe(true);
      expect(match(test, "3000")).toBe(false);
    });

    it("LIST-18: every word must match, each in any field", () => {
      const [web] = kai().grouped.environment;
      if (!web) throw new Error("fixture");
      expect(rowMatches(web, "kai-flaky", filterBy("flaky 3000"))).toBe(true);
      expect(rowMatches(web, "kai-flaky", filterBy("flaky 5173"))).toBe(false);
    });

    it("LIST-18: a section keeps only matching rows and drops empty thread groups", () => {
      const filtered = filterSection(kai(), filterBy("dev"));
      expect(ids(filtered)).toEqual(["web"]);
      expect(filtered.grouped.threads).toEqual([]);
    });

    it("LIST-19: shows sections with matches or errors, and empty environments by name once complete", () => {
      const sections = [
        section("idle-kai"),
        kai(),
        section("other", [terminal({ id: "o", title: "zsh" })]),
        section("failed", [], { error: "host offline" }),
        section("idle-web"),
      ];
      const { shown, emptyMatches } = filterAll(sections, filterBy("kai"), true);
      expect(shown.map((s) => s.environment.id)).toEqual(["kai-flaky", "failed"]);
      expect(emptyMatches.map((s) => s.environment.id)).toEqual(["idle-kai"]);
      expect(filterAll(sections, filterBy("idle kai"), true).emptyMatches).toHaveLength(1);
      expect(filterAll(sections, filterBy("kai"), false).emptyMatches).toEqual([]);
    });

    it("ACT-7: with a filter, the order keeps the selected terminal as an anchor between visible rows", () => {
      const sections = [
        section("a", [terminal({ id: "a1", title: "dev" }), terminal({ id: "a2", title: "zsh" })]),
        section("b", [terminal({ id: "b1", title: "zsh" }), terminal({ id: "b2", title: "dev" })]),
      ];
      const { shown } = filterAll(sections, filterBy("dev"), true);
      expect(filteredOrder(sections, shown, "a2")).toEqual(["a1", "a2", "b2"]);
      expect(filteredOrder(sections, shown, null)).toEqual(["a1", "b2"]);
    });
  });
});
