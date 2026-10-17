// A bb with two projects and a machine running the servers the findings
// describe: an agent's detached API server and its launch group, a Postgres
// whose folder is outside every environment, a vite in a bb terminal, one
// started by hand, and processes that belong to no environment.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createPlugin } from "../../server";
import { fakeSdk, thread, type World, world } from "./fake-bb";
import { agentEnv, fakeHost, type Machine, machine } from "./fake-host";

export const WORKTREE = "/Users/me/worktrees/thr-1/repo";

export function servicesWorld(overrides: Partial<World> = {}): World {
  return world({
    projects: [
      { id: "proj_1", name: "kai-platform" },
      { id: "proj_2", name: "terminal-hub" },
    ],
    environments: [
      {
        id: "env_a",
        projectId: "proj_1",
        name: null,
        branchName: "main",
        path: "/Users/me/repo",
        hostId: "host_1",
        status: "ready",
      },
      {
        id: "env_wt",
        projectId: "proj_1",
        name: null,
        branchName: "bb/map-all-page-urls",
        path: WORKTREE,
        hostId: "host_1",
        status: "ready",
      },
      {
        id: "env_remote",
        projectId: "proj_1",
        name: "remote-box",
        branchName: null,
        path: "/home/me/repo",
        hostId: "host_2",
        status: "ready",
      },
      {
        id: "env_b",
        projectId: "proj_2",
        name: null,
        branchName: "main",
        path: "/Users/me/hub",
        hostId: "host_1",
        status: "ready",
      },
    ],
    threads: [thread({ id: "thr_map", title: "Map all page URLs", environmentId: "env_wt" })],
    ...overrides,
  });
}

export function servicesMachine(): Machine {
  return machine(
    [
      // `nohup setsid … npm run dev`: the group's leader is gone.
      {
        pid: 48265,
        pgid: 48263,
        command: "npm run dev",
        cwd: WORKTREE,
        // npm rewrites its title over its environment.
        env: null,
      },
      {
        pid: 48304,
        pgid: 48263,
        command: "npm exec tsx watch apps/api/src/main.ts",
        cwd: WORKTREE,
        env: null,
      },
      {
        pid: 48345,
        pgid: 48263,
        start: "Sat Oct 17 20:19:50 2026",
        command: "/usr/local/bin/node apps/api/src/main.ts",
        cwd: WORKTREE,
        stdout: { type: "REG", path: "/Users/me/.agents/app.log" },
        env: agentEnv("env_wt", "thr_map"),
        ports: [55401],
      },
      // Daemonized by pg_ctl; its folder is its data folder.
      {
        pid: 33438,
        command: "/opt/homebrew/bin/postgres -D /Users/me/.agents/pg -p 55400",
        cwd: "/Users/me/.agents/pg",
        stdout: { type: "REG", path: "/Users/me/.agents/pg.log" },
        env: agentEnv("env_wt", "thr_map"),
        ports: [55400],
      },
      // In a bb terminal.
      {
        pid: 51000,
        pgid: 50990,
        command: "node node_modules/.bin/vite --port 5174",
        cwd: "/Users/me/hub",
        stdout: { type: "CHR", path: "/dev/ttys004" },
        env: { BB_TERMINAL_SESSION_ID: "term_1", BB_ENVIRONMENT_ID: "env_b" },
        ports: [5174],
      },
      // Started by hand in a folder of the environment, writing to a TTY.
      {
        pid: 51002,
        pgid: 51002,
        start: "Sat Oct 17 23:40:00 2026",
        command: "node node_modules/.bin/vite",
        cwd: "/Users/me/hub/web",
        stdout: { type: "CHR", path: "/dev/ttys003" },
        env: {},
        ports: [5173, 24678],
      },
      // Belongs to no environment.
      { pid: 700, command: "/usr/libexec/rapportd", cwd: "/", env: {}, ports: [7000] },
      // Unix sockets only.
      { pid: 800, command: "node lsp-server.js", cwd: "/Users/me/repo", env: {} },
    ],
    {
      "/Users/me/.agents/app.log": "booting\nlistening on :55401\n",
      "/Users/me/.agents/pg.log": "LOG:  database system is ready to accept connections\n",
    },
  );
}

const disposers: (() => Promise<void>)[] = [];

/** Disposes every server started since the last call. */
export async function disposeServers(): Promise<void> {
  for (const dispose of disposers.splice(0)) await dispose();
}

/** The plugin's server over `w` and `m`, as the page and the CLI reach it. */
export async function startServer(w: World, m: Machine) {
  const bb = fakeSdk(w);
  const fake = fakeHost(m);
  const { bb: api, harness } = createFakePluginHost({
    pluginId: "terminal-hub",
    sdk: bb.sdk as any,
  });
  await createPlugin(api, fake.host);
  disposers.push(() => harness.lifecycle.dispose());
  return {
    sdk: bb.sdk,
    machine: m,
    kills: fake.kills,
    calls: fake.calls,
    call: (method: string, input: unknown = null) =>
      harness.behavior.callRpc(method, input) as Promise<any>,
    runCli: harness.behavior.runCli.bind(harness.behavior),
  };
}
