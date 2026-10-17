import { afterEach, describe, expect, it } from "vitest";
import { bbExecutableOf } from "../lib/process-host";
import { parseFiles, parseListeners, parseProcesses } from "../lib/processes";
import { LOG_TAIL_BYTES } from "../lib/services";
import { BB, STARTED_AT } from "./fixtures/fake-host";
import {
  disposeServers,
  servicesMachine,
  servicesWorld,
  startServer,
  WORKTREE,
} from "./fixtures/services-world";

afterEach(disposeServers);

const API_STARTED = Date.parse("Sat Oct 17 20:19:50 2026");

async function listed() {
  const server = await startServer(servicesWorld(), servicesMachine());
  const list = await server.call("services.list");
  return { server, list };
}

const pids = (list: any) =>
  list.groups.flatMap((group: any) => group.services.map((service: any) => service.pid));

describe("services: what is listed", () => {
  it("SVC-2: lists a listener by its BB_ENVIRONMENT_ID, else by the environment folder holding its working folder", async () => {
    const { list } = await listed();
    const wt = list.groups.find((g: any) => g.environmentId === "env_wt");
    // Postgres runs in its data folder, outside every environment: found by its variable.
    expect(wt.services.map((s: any) => s.pid)).toEqual([33438, 48345]);
    // Started by hand, without bb variables: found by its folder, inside the environment's.
    const hub = list.groups.find((g: any) => g.environmentId === "env_b");
    expect(hub.services.map((s: any) => s.pid)).toEqual([51002]);
    // In no environment's folder, and no variable: not listed.
    expect(pids(list)).not.toContain(700);
  });

  it("SVC-2: a variable naming an environment bb does not know falls back to the folder", async () => {
    const m = servicesMachine();
    m.processes.push({
      pid: 900,
      command: "python3 -m http.server 8000",
      cwd: "/Users/me/repo/docs",
      env: { BB_ENVIRONMENT_ID: "env_gone", BB_THREAD_ID: "thr_gone" },
      ports: [8000],
    });
    const server = await startServer(servicesWorld(), m);
    const list = await server.call("services.list");
    const main = list.groups.find((g: any) => g.environmentId === "env_a");
    expect(main.services.map((s: any) => s.pid)).toEqual([900]);
  });

  it("SVC-2: when its environment cannot be read, only the folder applies", async () => {
    const m = servicesMachine();
    m.processes.push(
      {
        pid: 901,
        command: "ruby server.rb",
        cwd: `${WORKTREE}/api`,
        env: null,
        ports: [4567],
      },
      { pid: 902, command: "redis-server", cwd: "/opt/redis", env: null, ports: [6379] },
    );
    const server = await startServer(servicesWorld(), m);
    const list = await server.call("services.list");
    const wt = list.groups.find((g: any) => g.environmentId === "env_wt");
    expect(wt.services.map((s: any) => s.pid)).toContain(901);
    expect(pids(list)).not.toContain(902);
  });

  it("SVC-2: reads /proc/<pid>/environ on Linux, and the folder rule where it cannot", async () => {
    const m = servicesMachine();
    m.platform = "linux";
    const server = await startServer(servicesWorld(), m);
    const list = await server.call("services.list");
    expect(pids(list)).toEqual(expect.arrayContaining([33438, 48345, 51002]));
    expect(server.calls.some((call) => call.args[0] === "eww")).toBe(false);
  });

  it("SVC-3: a process with BB_TERMINAL_SESSION_ID is not listed", async () => {
    const { list } = await listed();
    expect(pids(list)).not.toContain(51000);
  });

  it("SVC-3: a process with a controlling terminal is not listed, even when its environment cannot be read", async () => {
    const m = servicesMachine();
    m.processes.push(
      // python3 in a bb terminal: Apple-signed, so ps shows no environment.
      {
        pid: 3000,
        pgid: 3000,
        tty: "ttys005",
        command: "/usr/bin/python3 -m http.server 8000",
        cwd: "/Users/me/repo",
        env: null,
        ports: [8000],
      },
      // Started from Terminal.app by an agent's variables.
      {
        pid: 3001,
        tty: "ttys006",
        command: "node g.js",
        cwd: "/tmp",
        env: agentEnv(),
        ports: [3080],
      },
    );
    const server = await startServer(servicesWorld(), m);
    const list = await server.call("services.list");
    expect(pids(list)).not.toContain(3000);
    expect(pids(list)).not.toContain(3001);
    expect(await server.stop(3000, STARTED_AT, false)).toEqual({ outcome: "changed" });
    expect(server.kills).toEqual([]);
  });

  it("SVC-22: bb's own processes are never listed nor signalled: the server, its ancestors, their groups, and bb's executable", async () => {
    const m = servicesMachine();
    m.selfPid = 1500;
    m.processes.push(
      // bb's app, its bridge, and the server running this plugin.
      { pid: 1480, pgid: 1480, command: BB, cwd: "/", env: {} },
      { pid: 1490, ppid: 1480, pgid: 1480, command: `${BB} bb-app-bridge.mjs`, env: {} },
      {
        pid: 1500,
        ppid: 1490,
        pgid: 1480,
        command: `${BB} server/dist/index.js`,
        cwd: "/Users/me",
        env: {},
        ports: [38886],
      },
      // The host daemon, in the same group.
      {
        pid: 1600,
        ppid: 1490,
        pgid: 1480,
        command: `${BB} host-daemon/daemon-bundle.mjs`,
        cwd: "/Users/me",
        env: {},
        ports: [38887],
      },
      // Not bb's executable, but in the ancestors' group.
      {
        pid: 1601,
        ppid: 1480,
        pgid: 1480,
        command: "/Applications/bb.app/Contents/Frameworks/bb Helper.app/Contents/MacOS/bb Helper",
        cwd: "/Users/me",
        env: {},
        ports: [38890],
      },
      // The provider bridge leading an agent's group in the environment's folder.
      {
        pid: 2000,
        ppid: 1600,
        pgid: 2000,
        command: `${BB} provider-bridge.mjs`,
        cwd: "/Users/me/repo",
        env: agentEnv(),
        ports: [38900],
      },
    );
    // An environment at the home folder holds them all.
    const w = servicesWorld();
    w.environments.push({
      id: "env_home",
      projectId: "proj_2",
      name: "home",
      branchName: null,
      path: "/Users/me",
      hostId: "host_1",
      status: "ready",
    });
    const server = await startServer(w, m);
    const list = await server.call("services.list");
    for (const pid of [1480, 1490, 1500, 1600, 1601, 2000]) {
      expect(pids(list)).not.toContain(pid);
      expect(await server.stop(pid, STARTED_AT, true)).toEqual({ outcome: "changed" });
    }
    // What runs at home that is not bb's is still listed.
    expect(pids(list)).toEqual(expect.arrayContaining([33438, 48345, 51002]));
    expect(server.kills).toEqual([]);
  });

  it("SVC-22: bb's executable is the server's own binary, unless that is a plain JavaScript runtime", () => {
    expect(bbExecutableOf("/Applications/bb.app/Contents/MacOS/bb")).toBe(
      "/Applications/bb.app/Contents/MacOS/bb",
    );
    expect(bbExecutableOf("/opt/bb/bb")).toBe("/opt/bb/bb");
    for (const runtime of ["/usr/local/bin/node", "/opt/homebrew/bin/node22", "/usr/bin/bun"]) {
      expect(bbExecutableOf(runtime)).toBeNull();
    }
  });

  it("SVC-22: bb's executable is only a rule when it is bb's own, not a plain Node", async () => {
    const m = servicesMachine();
    m.bbExecutable = null;
    m.processes.push({
      pid: 2100,
      command: "/usr/local/bin/node server.js",
      cwd: "/Users/me/repo",
      env: {},
      ports: [3090],
    });
    const server = await startServer(servicesWorld(), m);
    expect(pids(await server.call("services.list"))).toContain(2100);
  });

  it("SVC-20: a process listening only on Unix sockets is not listed; only TCP listeners are asked for", async () => {
    const { server, list } = await listed();
    expect(pids(list)).not.toContain(800);
    const scan = server.calls.find((call) => call.command === "lsof");
    expect(scan?.args).toEqual(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]);
  });

  it("SVC-4: each process once, with its ports ascending, its command line, PID, and start time", async () => {
    const { list } = await listed();
    const hub = list.groups.find((g: any) => g.environmentId === "env_b");
    expect(hub.services).toEqual([
      {
        pid: 51002,
        ports: [5173, 24678],
        command: "node node_modules/.bin/vite",
        startedAt: Date.parse("Sat Oct 17 23:40:00 2026"),
        environmentId: "env_b",
        threadId: null,
        threadTitle: null,
        logPath: null,
      },
    ]);
  });

  it("SVC-18: a process whose BB_THREAD_ID names a thread bb knows carries its title; an unknown thread none", async () => {
    const m = servicesMachine();
    m.processes.push({
      pid: 903,
      command: "node old.js",
      cwd: "/Users/me/repo",
      env: { BB_THREAD_ID: "thr_deleted" },
      ports: [3001],
    });
    const server = await startServer(servicesWorld(), m);
    const list = await server.call("services.list");
    const all = list.groups.flatMap((g: any) => g.services);
    expect(all.find((s: any) => s.pid === 48345)).toMatchObject({
      threadId: "thr_map",
      threadTitle: "Map all page URLs",
    });
    expect(all.find((s: any) => s.pid === 903)).toMatchObject({
      threadId: "thr_deleted",
      threadTitle: null,
    });
  });

  it("SVC-14: groups follow bb's project and environment order, named as LIST-34 names them, and only environments with a process", async () => {
    const { list } = await listed();
    expect(
      list.groups.filter((g: any) => g.checked).map((g: any) => [g.projectName, g.environmentName]),
    ).toEqual([
      ["kai-platform", "bb/map-all-page-urls"],
      ["terminal-hub", "main"],
    ]);
  });

  it("SVC-11: environments on another host are listed as not checked, without looking at their processes", async () => {
    const { list } = await listed();
    expect(list.groups.find((g: any) => g.environmentId === "env_remote")).toEqual({
      projectId: "proj_1",
      projectName: "kai-platform",
      environmentId: "env_remote",
      environmentName: "remote-box",
      checked: false,
      services: [],
    });
  });

  it("SVC-11: the machine running bb is bb's primary host; when bb does not say, no environment is checked", async () => {
    const server = await startServer(servicesWorld({ localHostId: null }), servicesMachine());
    const list = await server.call("services.list");
    expect(list.hostKnown).toBe(false);
    expect(list.groups).toHaveLength(4);
    expect(list.groups.every((g: any) => !g.checked && g.services.length === 0)).toBe(true);
  });

  it("SVC-11: when bb's config cannot be read, no environment is checked either", async () => {
    const server = await startServer(servicesWorld(), servicesMachine());
    server.sdk.system.config.mockRejectedValue(new Error("offline"));
    const list = await server.call("services.list");
    expect(list.hostKnown).toBe(false);
    expect(list.groups.every((g: any) => !g.checked)).toBe(true);
    // Asked again on the next scan.
    server.sdk.system.config.mockResolvedValue({ primaryHostId: "host_1" });
    expect((await server.call("services.list")).hostKnown).toBe(true);
  });

  it("SVC-12: where lsof is not installed, the list says detection is unavailable", async () => {
    const m = servicesMachine();
    m.lsof = false;
    const server = await startServer(servicesWorld(), m);
    expect(await server.call("services.list")).toEqual({
      available: false,
      hostKnown: true,
      groups: [],
      error: null,
    });
  });
});

describe("services: stopping", () => {
  it("SVC-8: re-checks the PID's start time, then sends SIGTERM", async () => {
    const { server } = await listed();
    expect(await server.stop(33438, STARTED_AT, false)).toEqual({ outcome: "signalled", count: 1 });
    // Postgres leads its own group (SVC-19).
    expect(server.kills).toEqual([{ target: -33438, signal: "SIGTERM" }]);
  });

  it("SVC-8: a PID now running something that started at another time is not signalled", async () => {
    const { server } = await listed();
    // The PID was reused after the scan.
    const pg = server.machine.processes.find((p) => p.pid === 33438)!;
    pg.start = "Sun Oct 18 09:00:00 2026";
    expect(await server.stop(33438, STARTED_AT, false)).toEqual({ outcome: "changed" });
    expect(await server.call("services.plan", { pid: 33438, startedAt: STARTED_AT })).toEqual({
      outcome: "changed",
    });
    expect(server.kills).toEqual([]);
  });

  it("SVC-13: a PID the latest scan did not list is never signalled", async () => {
    const { server } = await listed();
    for (const pid of [700, 800, 51000, 48265, 12345]) {
      expect(
        // Even with an expectation that matches what a signal would reach.
        await server.call("services.stop", {
          pid,
          startedAt: STARTED_AT,
          force: true,
          expected: { scope: "group", target: pid, count: 1 },
        }),
      ).toEqual({ outcome: "changed" });
    }
    // Listed once, but not by the latest scan.
    server.machine.processes = server.machine.processes.filter((p) => p.pid !== 33438);
    await server.call("services.list");
    server.machine.processes.push({ pid: 33438, command: "postgres", env: {} });
    expect(await server.stop(33438, STARTED_AT, false)).toEqual({ outcome: "changed" });
    expect(server.kills).toEqual([]);
  });

  it("SVC-13: nothing is signalled before a scan has listed it", async () => {
    const server = await startServer(servicesWorld(), servicesMachine());
    expect(await server.stop(33438, STARTED_AT, false)).toEqual({ outcome: "changed" });
    expect(server.kills).toEqual([]);
  });

  it("SVC-19: a launch whose group leader is gone is stopped as a group, launcher and watcher included", async () => {
    const { server } = await listed();
    expect(await server.call("services.plan", { pid: 48345, startedAt: API_STARTED })).toEqual({
      outcome: "ready",
      scope: "group",
      target: 48263,
      commands: [
        "npm run dev",
        "npm exec tsx watch apps/api/src/main.ts",
        "/usr/local/bin/node apps/api/src/main.ts",
      ],
    });
    expect(await server.stop(48345, API_STARTED, false)).toEqual({
      outcome: "signalled",
      count: 3,
    });
    expect(server.kills).toEqual([{ target: -48263, signal: "SIGTERM" }]);
    expect(server.machine.processes.some((p) => p.pgid === 48263)).toBe(false);
  });

  it("SVC-19: a listener leading its own group signals the group", async () => {
    const { server } = await listed();
    const plan = await server.call("services.plan", {
      pid: 51002,
      startedAt: Date.parse("Sat Oct 17 23:40:00 2026"),
    });
    expect(plan).toMatchObject({
      outcome: "ready",
      scope: "group",
      commands: [expect.any(String)],
    });
  });

  it("SVC-19: a group whose leader belongs to the same environment is signalled whole", async () => {
    const m = servicesMachine();
    m.processes.push(
      { pid: 960, pgid: 960, command: "zsh -c pnpm dev", env: agentEnv(), cwd: "/tmp" },
      {
        pid: 961,
        pgid: 960,
        command: "node dev.js",
        env: agentEnv(),
        cwd: "/Users/me/repo",
        ports: [3000],
      },
    );
    const server = await startServer(servicesWorld(), m);
    await server.call("services.list");
    expect(await server.call("services.plan", { pid: 961, startedAt: STARTED_AT })).toMatchObject({
      scope: "group",
      commands: ["zsh -c pnpm dev", "node dev.js"],
    });
  });

  it("SVC-19: only the listener when the leader is in another environment, unknown, or a group member has BB_TERMINAL_SESSION_ID", async () => {
    const m = servicesMachine();
    m.processes.push(
      // Leader belongs to another environment.
      { pid: 970, pgid: 970, command: "make dev", cwd: "/Users/me/hub", env: {} },
      { pid: 971, pgid: 970, command: "node a.js", cwd: "/Users/me/repo", env: {}, ports: [3010] },
      // Leader belongs to no environment.
      { pid: 980, pgid: 980, command: "login shell", cwd: "/", env: {} },
      { pid: 981, pgid: 980, command: "node b.js", cwd: "/Users/me/repo", env: {}, ports: [3020] },
      // A member runs in a bb terminal.
      {
        pid: 991,
        pgid: 990,
        command: "node c.js",
        cwd: "/Users/me/repo",
        env: {},
        ports: [3030],
      },
      { pid: 992, pgid: 990, command: "tail -f log", env: { BB_TERMINAL_SESSION_ID: "term_9" } },
    );
    const server = await startServer(servicesWorld(), m);
    await server.call("services.list");
    for (const pid of [971, 981, 991]) {
      expect(await server.call("services.plan", { pid, startedAt: STARTED_AT })).toEqual({
        outcome: "ready",
        scope: "process",
        target: pid,
        commands: [expect.stringMatching(/^node /)],
      });
    }
    expect(await server.stop(991, STARTED_AT, false)).toEqual({ outcome: "signalled", count: 1 });
    expect(server.kills).toEqual([{ target: 991, signal: "SIGTERM" }]);
  });

  it("SVC-19: only the listener when a group member's environment cannot be read, or it has a terminal", async () => {
    const m = servicesMachine();
    m.processes.push(
      // Apple-signed programs hide their environment from ps.
      { pid: 1100, pgid: 1100, command: "/bin/zsh -c make dev", cwd: "/Users/me/repo", env: null },
      {
        pid: 1101,
        pgid: 1100,
        command: "node d.js",
        cwd: "/Users/me/repo",
        env: {},
        ports: [3050],
      },
      // A member with a terminal (a job started from a shell).
      {
        pid: 1201,
        pgid: 1200,
        command: "node e.js",
        cwd: "/Users/me/repo",
        env: {},
        ports: [3060],
      },
      { pid: 1202, pgid: 1200, command: "tail -f x.log", tty: "ttys007", env: {} },
    );
    const server = await startServer(servicesWorld(), m);
    await server.call("services.list");
    for (const pid of [1101, 1201]) {
      expect(await server.call("services.plan", { pid, startedAt: STARTED_AT })).toMatchObject({
        scope: "process",
        target: pid,
      });
    }
    // The launch's own group, every member read: still the whole group.
    expect(
      await server.call("services.plan", { pid: 48345, startedAt: API_STARTED }),
    ).toMatchObject({ scope: "group", target: 48263 });
  });

  it("SVC-19: only the listener when a group member is protected", async () => {
    const m = servicesMachine();
    m.processes.push(
      // The provider bridge, running bb's executable, leads its agent's group.
      { pid: 2000, ppid: 1600, pgid: 2000, command: `${BB} provider-bridge.mjs`, env: agentEnv() },
      {
        pid: 2001,
        ppid: 2000,
        pgid: 2000,
        command: "claude",
        cwd: "/Users/me/repo",
        env: agentEnv(),
      },
      {
        pid: 2002,
        ppid: 2001,
        pgid: 2000,
        command: "node f.js",
        cwd: "/Users/me/repo",
        env: agentEnv(),
        ports: [3070],
      },
    );
    const server = await startServer(servicesWorld(), m);
    await server.call("services.list");
    expect(await server.call("services.plan", { pid: 2002, startedAt: STARTED_AT })).toEqual({
      outcome: "ready",
      scope: "process",
      target: 2002,
      commands: ["node f.js"],
    });
  });

  it("SVC-9: Force stop sends SIGKILL after the same identity check", async () => {
    const m = servicesMachine();
    m.processes.find((p) => p.pid === 33438)!.ignoresTerm = true;
    const server = await startServer(servicesWorld(), m);
    await server.call("services.list");
    await server.stop(33438, STARTED_AT, false);
    await server.call("services.list");
    expect(await server.stop(33438, STARTED_AT, true)).toEqual({ outcome: "signalled", count: 1 });
    expect(server.kills).toEqual([
      { target: -33438, signal: "SIGTERM" },
      { target: -33438, signal: "SIGKILL" },
    ]);
    expect(await server.stop(33438, STARTED_AT + 1000, true)).toEqual({ outcome: "changed" });
  });
});

describe("services: stopping what was confirmed", () => {
  it("SVC-19: when the group changed between the confirmation and Stop, nothing is signalled", async () => {
    const { server } = await listed();
    const plan = await server.call("services.plan", { pid: 48345, startedAt: API_STARTED });
    const expected = { scope: plan.scope, target: plan.target, count: plan.commands.length };
    expect(expected).toEqual({ scope: "group", target: 48263, count: 3 });
    // The watcher started another process in the group meanwhile.
    server.machine.processes.push({ pid: 48373, pgid: 48263, command: "esbuild --service" });
    expect(
      await server.call("services.stop", {
        pid: 48345,
        startedAt: API_STARTED,
        force: false,
        expected,
      }),
    ).toEqual({ outcome: "changed" });
    // A member now runs in a bb terminal: only the listener would be signalled.
    server.machine.processes = server.machine.processes.filter((p) => p.pid !== 48373);
    server.machine.processes.find((p) => p.pid === 48304)!.env = {
      BB_TERMINAL_SESSION_ID: "term_2",
    };
    expect(
      await server.call("services.stop", {
        pid: 48345,
        startedAt: API_STARTED,
        force: false,
        expected,
      }),
    ).toEqual({ outcome: "changed" });
    expect(server.kills).toEqual([]);
  });

  it("SVC-9: a process sent SIGTERM that closed its port but still runs stays listed and can be force-stopped", async () => {
    const m = servicesMachine();
    const pg = m.processes.find((p) => p.pid === 33438)!;
    pg.ignoresTerm = true;
    const server = await startServer(servicesWorld(), m);
    await server.call("services.list");
    expect(await server.stop(33438, STARTED_AT, false)).toEqual({
      outcome: "signalled",
      count: 1,
    });
    // Shutting down: the port is closed, the process lives on.
    pg.ports = [];
    const list = await server.call("services.list");
    expect(pids(list)).toContain(33438);
    expect(await server.stop(33438, STARTED_AT, true)).toEqual({
      outcome: "signalled",
      count: 1,
    });
    expect(server.kills.at(-1)).toEqual({ target: -33438, signal: "SIGKILL" });
    // Gone: no longer listed, and nothing more is signalled.
    expect(pids(await server.call("services.list"))).not.toContain(33438);
    expect(await server.stop(33438, STARTED_AT, true)).toEqual({ outcome: "changed" });
    expect(server.kills).toHaveLength(2);
  });

  it("SVC-9, SVC-13: a stopped process whose PID now runs something else is not kept nor signalled", async () => {
    const m = servicesMachine();
    m.processes.find((p) => p.pid === 33438)!.ignoresTerm = true;
    const server = await startServer(servicesWorld(), m);
    await server.call("services.list");
    await server.stop(33438, STARTED_AT, false);
    m.processes = m.processes.filter((p) => p.pid !== 33438);
    m.processes.push({ pid: 33438, start: "Sun Oct 18 09:00:00 2026", command: "other", env: {} });
    expect(pids(await server.call("services.list"))).not.toContain(33438);
    expect(await server.stop(33438, STARTED_AT, true)).toEqual({ outcome: "changed" });
    expect(server.kills).toEqual([{ target: -33438, signal: "SIGTERM" }]);
  });
});

describe("services: logs", () => {
  it("SVC-5: reads the last 64 KB of the listed process's log file, starting at a whole line", async () => {
    const m = servicesMachine();
    const line = `${"x".repeat(99)}\n`;
    m.files["/Users/me/.agents/pg.log"] = `${line.repeat(700)}last line\n`;
    const server = await startServer(servicesWorld(), m);
    await server.call("services.list");
    const log = await server.call("services.log", { pid: 33438, startedAt: STARTED_AT });
    expect(log.outcome).toBe("log");
    expect(log.path).toBe("/Users/me/.agents/pg.log");
    expect(log.text.length).toBeLessThanOrEqual(LOG_TAIL_BYTES);
    expect(log.text.startsWith("x")).toBe(true);
    expect(log.text.endsWith("last line\n")).toBe(true);
  });

  it("SVC-5: a process whose standard output is not a regular file has no log", async () => {
    const { server } = await listed();
    expect(
      await server.call("services.log", {
        pid: 51002,
        startedAt: Date.parse("Sat Oct 17 23:40:00 2026"),
      }),
    ).toEqual({ outcome: "none" });
  });

  it("SVC-16: a process the latest scan no longer lists has ended", async () => {
    const { server } = await listed();
    server.machine.processes = server.machine.processes.filter((p) => p.pid !== 33438);
    await server.call("services.list");
    expect(await server.call("services.log", { pid: 33438, startedAt: STARTED_AT })).toEqual({
      outcome: "ended",
    });
  });
});

describe("services: reading lsof and ps", () => {
  it("SVC-2, SVC-4: parses listeners, processes, and files as lsof and ps print them", () => {
    expect(
      parseListeners("p947\ncrapportd\nf12\nn*:61183\nf13\nn*:61183\nf22\nn127.0.0.1:50480\n"),
    ).toEqual(new Map([[947, new Set([61183, 50480])]]));
    expect(
      parseProcesses(
        "33438     1 33438 ??       Sat Oct 17 20:16:31 2026     /opt/postgres -D /pg\n 7809  7767  7767 ttys001  Thu Oct  1 22:23:04 2026     node x\n 900   899   899 pts/2    Thu Oct  1 22:23:04 2026     vim\n 901     1   901 ?        Thu Oct  1 22:23:04 2026     sshd\n",
      ),
    ).toEqual([
      {
        pid: 33438,
        ppid: 1,
        pgid: 33438,
        tty: null,
        startedAt: Date.parse("Sat Oct 17 20:16:31 2026"),
        command: "/opt/postgres -D /pg",
      },
      {
        pid: 7809,
        ppid: 7767,
        pgid: 7767,
        tty: "ttys001",
        startedAt: Date.parse("Thu Oct 1 22:23:04 2026"),
        command: "node x",
      },
      expect.objectContaining({ pid: 900, tty: "pts/2" }),
      expect.objectContaining({ pid: 901, tty: null }),
    ]);
    expect(
      parseFiles(
        "p33438\nfcwd\ntDIR\nn/pg\nf1\ntREG\nn/pg.log\np48345\nfcwd\ntDIR\nn/wt\nf1\ntCHR\nn/dev/null\n",
      ),
    ).toEqual(
      new Map([
        [33438, { cwd: "/pg", log: "/pg.log" }],
        [48345, { cwd: "/wt", log: null }],
      ]),
    );
  });
});

function agentEnv() {
  return { BB_ENVIRONMENT_ID: "env_a", BB_THREAD_ID: "thr_x" };
}
