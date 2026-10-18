import { readFile } from "node:fs/promises";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupEnvironment, loadEnvironment, orderedRows } from "../lib/inventory";
import plugin from "../server";
import { fakeSdk, terminal, thread, type World, world } from "./fixtures/fake-bb";
import { STARTED_AT } from "./fixtures/fake-host";
import {
  disposeServers,
  labelledMachine,
  RECORD,
  servicesMachine,
  servicesWorld,
  startServer,
} from "./fixtures/services-world";

const hosts: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.dispose();
  await disposeServers();
});

async function cli(w: World) {
  const { sdk } = fakeSdk(w);
  const { bb, harness } = createFakePluginHost({ pluginId: "terminal-hub", sdk: sdk as any });
  await plugin(bb);
  hosts.push({ dispose: () => harness.lifecycle.dispose() });
  return { sdk, run: harness.behavior.runCli.bind(harness.behavior) };
}

const busy = () =>
  world({
    threads: [
      thread({ id: "thr_tests", title: "Fix flaky tests", status: "idle", latestAttentionAt: 10 }),
      thread({ id: "thr_live", title: "Ship it", status: "active", latestAttentionAt: 20 }),
      thread({ id: "thr_old", title: "Release prep", archivedAt: 5, latestAttentionAt: 1 }),
    ],
    terminals: [
      terminal({ id: "term_dev", title: "dev server", initialCwd: "/Users/me/repo/web" }),
      terminal({ id: "term_test", title: "pnpm test", threadId: "thr_tests" }),
      terminal({ id: "term_build", title: "build", threadId: "thr_live" }),
      terminal({ id: "term_watch", title: "watch", threadId: "thr_old" }),
    ],
    output: { term_dev: "  ➜  Local:   http://localhost:5173/\n" },
  });

describe("agent surface", () => {
  it("AGENT-1: ships a skill telling agents to start long-running processes at environment scope with a title", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8"));
    expect(manifest.bb.skills).toEqual(["skills"]);
    const skill = await readFile("skills/terminal-hub/SKILL.md", "utf8");
    expect(skill).toMatch(/^---\nname: terminal-hub\ndescription: .+\n---\n/);
    expect(skill).toContain("bb terminal create --environment");
    expect(skill).toMatch(/--title "[^"]+"/);
    expect(skill).toMatch(/long-running processes at environment\s+scope/);
  });

  it("AGENT-2: the skill says to list what is running first and reuse a match instead of a duplicate", async () => {
    const skill = await readFile("skills/terminal-hub/SKILL.md", "utf8");
    const before = skill.indexOf("## Before starting");
    const starting = skill.indexOf("## Starting one");
    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(starting);
    const section = skill.slice(before, starting);
    expect(section).toContain("bb terminal-hub list");
    expect(section).toMatch(/reuse it/);
    expect(section).toMatch(/Do not start a duplicate/);
  });

  it("AGENT-6: the skill says to leave environment processes running; cleanup is the user's call", async () => {
    const skill = await readFile("skills/terminal-hub/SKILL.md", "utf8");
    expect(skill).toMatch(
      /Leave environment-scoped long-running processes running unless the user asks\s+you to stop them/,
    );
    expect(skill).toMatch(/Cleaning them up is the user's call/);
  });

  it("AGENT-3: lists the same terminals as the page, grouped the same way, with each thread's title and state", async () => {
    const w = busy();
    const { run, sdk } = await cli(w);
    const result = await run(["list", "--environment", "env_a"]);
    expect(result.exitCode).toBe(0);
    const lines = (result.stdout ?? "").split("\n");
    expect(lines[0]).toBe("Terminals in environment env_a");
    expect(lines[1]).toBe("Environment");
    expect(lines[2]).toContain("dev server");
    expect(lines[2]).toContain("~/repo/web");
    expect(lines[2]).toContain("http://localhost:5173/");
    expect(lines[3]).toBe("From threads");
    expect(result.stdout).toContain('thread "Fix flaky tests" (thr_tests) idle');
    expect(result.stdout).toContain('thread "Release prep" (thr_old) archived');
    expect(result.stdout).toContain('thread "Ship it" (thr_live) active');

    const page = orderedRows(groupEnvironment(await loadEnvironment(sdk, "env_a"))).map(
      (row) => row.terminal.id,
    );
    const listed = lines.flatMap((line) => line.match(/term_\w+/g) ?? []);
    expect(listed).toEqual(page);
  });

  it("AGENT-4: defaults to the calling thread's environment", async () => {
    const w = busy();
    w.threads.push(thread({ id: "thr_caller", environmentId: "env_a" }));
    const { run } = await cli(w);
    const result = await run(["list"], { threadId: "thr_caller" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Terminals in environment env_a");
  });

  it("AGENT-4: --environment chooses another environment", async () => {
    const w = busy();
    w.terminals.push(terminal({ id: "term_b", title: "api", environmentId: "env_b" }));
    w.threads.push(thread({ id: "thr_caller", environmentId: "env_a" }));
    const { run } = await cli(w);
    const result = await run(["list", "--environment", "env_b"], { threadId: "thr_caller" });
    expect(result.stdout).toContain("Terminals in environment env_b");
    expect(result.stdout).toContain("api");
    expect(result.stdout).not.toContain("dev server");
  });

  it("AGENT-4: without a thread or --environment, fails and says to pass --environment", async () => {
    const { run } = await cli(busy());
    const result = await run(["list"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--environment");
  });

  it("AGENT-5: --json prints each terminal's id, title, status, scope, thread, and server hint", async () => {
    const { run } = await cli(busy());
    const result = await run(["list", "--environment", "env_a", "--json"]);
    const parsed = JSON.parse(result.stdout ?? "");
    expect(parsed.environmentId).toBe("env_a");
    const dev = parsed.terminals.find((t: { id: string }) => t.id === "term_dev");
    expect(dev).toMatchObject({
      id: "term_dev",
      title: "dev server",
      status: "running",
      scope: "environment",
      thread: null,
      serverHint: "http://localhost:5173/",
    });
    const test = parsed.terminals.find((t: { id: string }) => t.id === "term_test");
    expect(test).toMatchObject({
      scope: "thread",
      serverHint: null,
      thread: { id: "thr_tests", title: "Fix flaky tests", state: "idle", stale: true },
    });
  });
});

describe("agent surface: services", () => {
  it("AGENT-9: the skill says to run services as well as list before starting a server, and reuse a listed one", async () => {
    const skill = await readFile("skills/terminal-hub/SKILL.md", "utf8");
    const section = skill.slice(
      skill.indexOf("## Before starting"),
      skill.indexOf("## Starting one"),
    );
    expect(section).toContain("bb terminal-hub list");
    expect(section).toContain("bb terminal-hub services");
    expect(section).toMatch(
      /If `services` lists a server with the command or port you need, reuse it/,
    );
    expect(section).toMatch(/Do not start a\s+duplicate/);
  });

  it("AGENT-7: prints the processes the Services page lists for the environment, with ports, PID, command line, thread, and log path", async () => {
    vi.setSystemTime(STARTED_AT + 2 * 3_600_000);
    const server = await startServer(servicesWorld(), servicesMachine());
    const page = await server.call("services.list");
    const result = await server.runCli(["services", "--environment", "env_wt"]);
    expect(result.exitCode).toBe(0);
    const lines = (result.stdout ?? "").split("\n");
    expect(lines[0]).toBe("Services in environment env_wt (kai-platform › bb/map-all-page-urls)");
    expect(result.stdout).toContain(
      "  :55400  pid 33438  up 2h  /opt/homebrew/bin/postgres -D /Users/me/.agents/pg -p 55400",
    );
    expect(result.stdout).toContain('    started by thread "Map all page URLs" (thr_map)');
    expect(result.stdout).toContain("    log /Users/me/.agents/pg.log");
    const listed = lines.flatMap((line) => line.match(/pid (\d+)/)?.[1] ?? []).map(Number);
    const shown = page.groups
      .find((g: any) => g.environmentId === "env_wt")
      .services.map((s: any) => s.pid);
    expect(listed).toEqual(shown);
    vi.useRealTimers();
  });

  it("AGENT-7: chooses the environment as AGENT-4 does, and says when it has none or is not checked", async () => {
    const server = await startServer(servicesWorld(), servicesMachine());
    const own = await server.runCli(["services"], { threadId: "thr_map" });
    expect(own.stdout).toContain("Services in environment env_wt");
    const main = await server.runCli(["services", "--environment", "env_a"], {
      threadId: "thr_map",
    });
    expect(main.stdout).toContain("Services in environment env_a");
    expect(main.stdout).toContain("(none running)");
    const remote = await server.runCli(["services", "--environment", "env_remote"]);
    expect(remote.stdout).toContain("Not checked: the environment is on another host.");
    const none = await server.runCli(["services"]);
    expect(none.exitCode).not.toBe(0);
    expect(none.stderr).toContain("--environment");
  });

  it("AGENT-8: --json prints each process's pid, ports, command, startedAt, threadId, logPath, environmentId, name, and set", async () => {
    const server = await startServer(servicesWorld(), servicesMachine());
    const result = await server.runCli(["services", "--environment", "env_b", "--json"]);
    expect(JSON.parse(result.stdout ?? "")).toEqual({
      environmentId: "env_b",
      available: true,
      checked: true,
      services: [
        {
          pid: 51002,
          ports: [5173, 24678],
          command: "node node_modules/.bin/vite",
          startedAt: Date.parse("Sat Oct 17 23:40:00 2026"),
          threadId: null,
          logPath: null,
          environmentId: "env_b",
          name: null,
          set: null,
        },
      ],
    });
  });

  it("AGENT-7: prints each labelled process's service name and set title, or the record's path when it has none; never URLs or credentials", async () => {
    const server = await startServer(servicesWorld(), labelledMachine());
    const result = await server.runCli(["services", "--environment", "env_wt"]);
    const lines = (result.stdout ?? "").split("\n");
    const lineAfter = (pid: number) => lines[lines.findIndex((l) => l.includes(`pid ${pid} `)) + 1];
    expect(lineAfter(33438)).toBe(
      '    service postgres, set "kai-platform — multi-org access case"',
    );
    expect(lineAfter(48345)).toBe('    service api, set "kai-platform — multi-org access case"');
    expect(result.stdout).not.toMatch(/abcd1234|kai_app_dev|postgres:\/\/|Case login/);

    const unreadable = await startServer(servicesWorld(), labelledMachine(null));
    const text = (await unreadable.runCli(["services", "--environment", "env_wt"])).stdout ?? "";
    expect(text).toContain(`    service api, set record ${RECORD}`);
    // Unlabelled processes print as before.
    const plain = await server.runCli(["services", "--environment", "env_b"]);
    expect(plain.stdout).not.toContain("service ");
  });

  it("AGENT-8: --json adds each process's name and set (record, id, title); never URLs or credentials", async () => {
    const server = await startServer(servicesWorld(), labelledMachine());
    const result = await server.runCli(["services", "--environment", "env_wt", "--json"]);
    const parsed = JSON.parse(result.stdout ?? "");
    expect(parsed.services.map((s: any) => [s.pid, s.name, s.set])).toEqual([
      [
        33438,
        "postgres",
        {
          record: RECORD,
          id: "20261017-201623-d32d",
          title: "kai-platform — multi-org access case",
        },
      ],
      [
        48345,
        "api",
        {
          record: RECORD,
          id: "20261017-201623-d32d",
          title: "kai-platform — multi-org access case",
        },
      ],
    ]);
    expect(result.stdout).not.toMatch(/abcd1234|kai_app_dev|postgres:\/\/|"case"|credentials|urls/);
  });

  it("AGENT-10: the skill tells agents that start a detached server to label it with the agent service record", async () => {
    const skill = await readFile("skills/terminal-hub/SKILL.md", "utf8");
    const section = skill.slice(
      skill.indexOf("## Labelling a detached server"),
      skill.indexOf("## When your work is done"),
    );
    expect(section).toContain("agent service record, version 1");
    expect(section).toContain("AGENT_SERVICE_RECORD=");
    expect(section).toContain("AGENT_SERVICE_NAME=");
    expect(section).toContain("services.json");
    expect(section).toContain('"version": 1');
    for (const field of [
      "title",
      "case",
      "credentials",
      "services",
      "name",
      "ports",
      "urls",
      "log",
    ]) {
      expect(section).toContain(`\`${field}\``);
    }
    expect(section).not.toContain("throwaway-services");
  });
});
