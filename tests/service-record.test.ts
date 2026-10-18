import { afterEach, describe, expect, it } from "vitest";
import { RECORD_MAX_BYTES } from "../lib/service-record";
import { STARTED_AT } from "./fixtures/fake-host";
import {
  disposeServers,
  labelledMachine,
  labels,
  RECORD,
  recordJson,
  servicesMachine,
  servicesWorld,
  startServer,
  WORKTREE,
} from "./fixtures/services-world";

afterEach(disposeServers);

const API_STARTED = Date.parse("Sat Oct 17 20:19:50 2026");
const VITE_STARTED = Date.parse("Sat Oct 17 23:40:00 2026");
const OTHER_RECORD = "/Users/me/.agents/throwaway-services/20261018-090000-beef/services.json";

const all = (list: any): any[] => list.groups.flatMap((group: any) => group.services);
const byPid = (list: any, pid: number) => all(list).find((service: any) => service.pid === pid);
const group = (list: any, environmentId: string) =>
  list.groups.find((g: any) => g.environmentId === environmentId);

async function listedWith(m = labelledMachine()) {
  const server = await startServer(servicesWorld(), m);
  const list = await server.call("services.list");
  return { server, list };
}

describe("service record: sets and names", () => {
  it("SVC-25: processes with the same AGENT_SERVICE_RECORD form a set, together and by port within their environment; sets by lowest port, unlabelled rows after", async () => {
    const m = labelledMachine();
    m.processes.push(
      // Another set, unreadable, whose lowest port is lower.
      {
        pid: 61025,
        command: "/opt/homebrew/bin/mailpit --smtp :1025",
        cwd: WORKTREE,
        env: { BB_ENVIRONMENT_ID: "env_wt", ...labels("mail", OTHER_RECORD) },
        ports: [1025, 61080],
      },
      // Unlabelled, on a lower port than every set.
      { pid: 60001, command: "node other.js", cwd: WORKTREE, env: {}, ports: [3000] },
    );
    const { list } = await listedWith(m);
    expect(group(list, "env_wt").services.map((s: any) => [s.pid, s.set?.record ?? null])).toEqual([
      [61025, OTHER_RECORD],
      [33438, RECORD],
      [48345, RECORD],
      [60001, null],
    ]);
    expect(byPid(list, 33438).set).toEqual({
      record: RECORD,
      id: "20261017-201623-d32d",
      title: "kai-platform — multi-org access case",
      case: "adi@strata.co.jp is platform admin, writer at Demo AM Co, read-only at Contoso",
    });
    // Unreadable: still a set, by the variable's value.
    expect(byPid(list, 61025).set).toEqual({
      record: OTHER_RECORD,
      id: null,
      title: null,
      case: null,
    });
  });

  it("SVC-26: a process is named by its AGENT_SERVICE_NAME, even with no matching entry or no readable record", async () => {
    const m = labelledMachine(null);
    m.processes.push({
      pid: 61026,
      command: "redis-server *:6390",
      cwd: WORKTREE,
      env: { BB_ENVIRONMENT_ID: "env_wt", AGENT_SERVICE_NAME: "redis" },
      ports: [6390],
    });
    const { list } = await listedWith(m);
    expect(byPid(list, 48345)).toMatchObject({ name: "api", set: { record: RECORD, title: null } });
    expect(byPid(list, 33438).name).toBe("postgres");
    // A name without a record is named, in no set.
    expect(byPid(list, 61026)).toMatchObject({ name: "redis", set: null });
    expect(byPid(list, 51002)).toMatchObject({ name: null, set: null });
  });

  it("SVC-25, SVC-26: labels are read from ps on macOS and /proc on Linux, a record path with spaces included", async () => {
    const spaced = "/Users/me/Library/Application Support/agents/set 1/services.json";
    for (const platform of ["darwin", "linux"]) {
      const m = servicesMachine();
      m.platform = platform;
      const api = m.processes.find((p) => p.pid === 48345)!;
      api.env = { ...api.env, ...labels("api", spaced) };
      m.records = { [spaced]: JSON.stringify(recordJson()) };
      const { list } = await listedWith(m);
      expect(byPid(list, 48345)).toMatchObject({
        name: "api",
        set: { record: spaced, title: "kai-platform — multi-org access case" },
        // bb's own variables are read as before.
        threadId: "thr_map",
        environmentId: "env_wt",
      });
    }
  });
});

describe("service record: reading it", () => {
  const unreadable: [string, (m: ReturnType<typeof labelledMachine>) => void][] = [
    ["a relative path", (m) => relabel(m, "services.json", { "services.json": valid() })],
    ["a symlink", (m) => (m.records = { [RECORD]: { kind: "symlink" } })],
    ["not a regular file", (m) => (m.records = { [RECORD]: { kind: "other" } })],
    ["owned by another user", (m) => (m.records = { [RECORD]: { text: valid(), uid: 0 } })],
    ["no user to compare with", (m) => (m.uid = null)],
    ["missing", (m) => (m.records = {})],
    [
      "larger than 64 KiB",
      (m) => (m.records = { [RECORD]: valid().padEnd(RECORD_MAX_BYTES, " ") }),
    ],
    ["invalid JSON", (m) => (m.records = { [RECORD]: "{ version: 1" })],
    ["not an object", (m) => (m.records = { [RECORD]: JSON.stringify([recordJson()]) })],
    ["version 2", (m) => (m.records = { [RECORD]: valid({ version: 2 }) })],
    ["version as a string", (m) => (m.records = { [RECORD]: valid({ version: "1" }) })],
    ["without version", (m) => (m.records = { [RECORD]: valid({ version: undefined }) })],
    ["without services", (m) => (m.records = { [RECORD]: valid({ services: undefined }) })],
    ["services not an array", (m) => (m.records = { [RECORD]: valid({ services: {} }) })],
  ];

  for (const [what, make] of unreadable) {
    it(`SVC-27: a record that is ${what} is unreadable; the set and the name still apply`, async () => {
      const m = labelledMachine();
      make(m);
      const { server, list } = await listedWith(m);
      const api = byPid(list, 48345);
      expect(api.name).toBe("api");
      expect(api.set).toMatchObject({ id: null, title: null, case: null });
      expect(byPid(list, 33438).set.record).toBe(api.set.record);
      expect(await server.call("services.connect", { pid: 48345, startedAt: API_STARTED })).toEqual(
        { outcome: "none" },
      );
    });
  }

  it("SVC-27: a record of exactly 64 KiB is read", async () => {
    const json = valid();
    const m = labelledMachine(
      json.padEnd(RECORD_MAX_BYTES - (Buffer.byteLength(json) - json.length), " "),
    );
    const { list } = await listedWith(m);
    expect(byPid(list, 48345).set.title).toBe("kai-platform — multi-org access case");
  });

  it("SVC-27: fields of the wrong type, entries missing a required field, and unknown fields are ignored one by one", async () => {
    const record = recordJson({
      title: 42,
      case: ["not", "a", "string"],
      owner: "unknown field",
      credentials: [
        { username: "no-label@example.com", secret: "x" },
        { label: "Case login", username: 7, secret: "abcd1234", note: "unknown" },
        "not an object",
      ],
      services: [
        { kind: "no name" },
        { name: "Not Valid!", urls: [] },
        {
          name: "api",
          urls: [
            { url: "http://127.0.0.1:1" },
            { label: "No URL" },
            { label: "App", url: "http://127.0.0.1:55401", extra: true },
          ],
          ports: "55401",
        },
        { name: "api", urls: [{ label: "Duplicate", url: "http://127.0.0.1:2" }] },
      ],
    });
    const { server, list } = await listedWith(labelledMachine(JSON.stringify(record)));
    expect(byPid(list, 48345).set).toEqual({
      record: RECORD,
      id: "20261017-201623-d32d",
      title: null,
      case: null,
    });
    expect(await server.call("services.connect", { pid: 48345, startedAt: API_STARTED })).toEqual({
      outcome: "connect",
      urls: [{ label: "App", url: "http://127.0.0.1:55401" }],
      credentials: [{ label: "Case login", username: null, secret: "abcd1234" }],
    });
  });

  it("SVC-27: a set's record is read once per scan, and only for listed processes", async () => {
    const m = labelledMachine();
    // Labelled, but in no environment: never listed, so its record is never read.
    m.processes.push({
      pid: 702,
      command: "node elsewhere.js",
      cwd: "/tmp",
      env: labels("web", OTHER_RECORD),
      ports: [7002],
    });
    const { server } = await listedWith(m);
    expect(server.reads).toEqual([RECORD]);
    await server.call("services.list");
    expect(server.reads).toEqual([RECORD, RECORD]);
  });
});

describe("service record: connect", () => {
  it("SVC-28: the selected process's entry's URLs and the set's credentials, read from the record now", async () => {
    const { server } = await listedWith();
    expect(await server.call("services.connect", { pid: 33438, startedAt: STARTED_AT })).toEqual({
      outcome: "connect",
      urls: [
        { label: "Superuser", url: "postgres://postgres@127.0.0.1:55400/kai_platform" },
        { label: "App role", url: "postgres://kai_app:kai_app_dev@127.0.0.1:55400/kai_platform" },
      ],
      credentials: [{ label: "Case login", username: "adi@strata.co.jp", secret: "abcd1234" }],
    });
    // Rewritten since the scan: the drawer shows what it says now.
    server.machine.records = {
      [RECORD]: valid({ credentials: [{ label: "Admin", username: "root", secret: "s3cret" }] }),
    };
    const api = await server.call("services.connect", { pid: 48345, startedAt: API_STARTED });
    expect(api).toMatchObject({
      urls: [{ label: "App", url: "http://127.0.0.1:55401" }],
      credentials: [{ label: "Admin", username: "root", secret: "s3cret" }],
    });
  });

  it("SVC-28: no Connect without an entry named as the process, nor for a process not listed", async () => {
    const m = labelledMachine(valid({ services: [{ name: "web", urls: [] }] }));
    const { server } = await listedWith(m);
    expect(await server.call("services.connect", { pid: 48345, startedAt: API_STARTED })).toEqual({
      outcome: "none",
    });
    expect(await server.call("services.connect", { pid: 51002, startedAt: VITE_STARTED })).toEqual({
      outcome: "none",
    });
    expect(await server.call("services.connect", { pid: 48345, startedAt: 1 })).toEqual({
      outcome: "ended",
    });
    expect(await server.call("services.connect", { pid: 4242, startedAt: STARTED_AT })).toEqual({
      outcome: "ended",
    });
  });

  it("SVC-28, SVC-29: the list carries no URL and no credential; only Connect does", async () => {
    const { list } = await listedWith();
    const text = JSON.stringify(list);
    expect(text).not.toContain("abcd1234");
    expect(text).not.toContain("kai_app_dev");
    expect(text).not.toContain("postgres://");
  });
});

describe("service record: never acted on", () => {
  it("SVC-30: a record naming other ports, logs, and services changes nothing listed, no log shown, and no Stop target", async () => {
    const hostile = valid({
      services: [
        {
          name: "api",
          ports: [9999],
          log: "/etc/master.passwd",
          urls: [{ label: "App", url: "http://127.0.0.1:9999" }],
        },
        { name: "postgres", ports: [1], log: "/Users/me/.ssh/id_ed25519" },
        { name: "rapportd", ports: [7000], log: "/var/log/system.log" },
      ],
    });
    const plain = await listedWith(servicesMachine());
    const labelled = await listedWith(labelledMachine(hostile));
    const shape = (list: any) =>
      list.groups.map((g: any) => ({
        environmentId: g.environmentId,
        services: g.services.map(({ name: _n, set: _s, ...rest }: any) => rest),
      }));
    expect(shape(labelled.list)).toEqual(shape(plain.list));
    // The log is the process's standard output, as lsof says.
    for (const server of [plain.server, labelled.server]) {
      expect(await server.call("services.log", { pid: 48345, startedAt: API_STARTED })).toEqual({
        outcome: "log",
        path: "/Users/me/.agents/app.log",
        text: "booting\nlistening on :55401\n",
        error: null,
      });
    }
    expect(labelled.server.reads).toEqual([RECORD]);
    // Stop plans the same target, and signals what it planned.
    const plan = (server: any) =>
      server.call("services.plan", { pid: 48345, startedAt: API_STARTED });
    expect(await plan(labelled.server)).toEqual(await plan(plain.server));
    expect(await labelled.server.stop(48345, API_STARTED, false)).toEqual({
      outcome: "signalled",
      count: 3,
    });
    expect(labelled.server.kills).toEqual([{ target: -48263, signal: "SIGTERM" }]);
  });
});

function valid(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(recordJson(overrides));
}

/** Points every labelled process at `record`, with `records` on the machine. */
function relabel(
  m: ReturnType<typeof labelledMachine>,
  record: string,
  records: Record<string, string>,
) {
  for (const p of m.processes) {
    if (p.env?.AGENT_SERVICE_RECORD) p.env = { ...p.env, AGENT_SERVICE_RECORD: record };
  }
  m.records = records;
}
