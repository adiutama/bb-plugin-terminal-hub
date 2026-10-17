# Can the plugin see servers agents start outside bb terminals?

- Date: 2026-10-17
- bb: 0.46.1
- Plugin SDK: 0.6.37

## Question

In @thread:thr_6z6iitf6ba an agent started kai-platform's dev server and a
Postgres for it, and neither appeared in the hub. How was it started, and can
the plugin find such processes, tell which environment they belong to, and
stop them?

## Procedure

1. Read the thread's log (`bb thread log thr_6z6iitf6ba --json --all`) for the
   launch command, and the `services.md` record it wrote.
2. `lsof -nP -iTCP:55401 -sTCP:LISTEN`, then
   `lsof -a -p <pid> -d cwd -Fn` for the listener's working folder.
3. Read the SDK's bundled types
   (`node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`) and the
   bb-plugin-authoring references for process, port, RPC and host APIs.

## Result

- The user's `/throwaway-services` skill starts everything detached so it
  outlives the session:
  `nohup setsid mise exec -- npm run dev > $D/app-kai.log 2>&1 < /dev/null &`.
  The launcher (`npm run dev`, pid 48265) is reparented to launchd (ppid 1);
  the listener is a child `node` (pid 48345). Postgres daemonizes itself via
  `pg_ctl`. No bb terminal is involved, so the hub, which lists bb terminals
  only, cannot show them.
- `lsof` finds the listener (`node 48345 … TCP *:55401 (LISTEN)`), and its
  working folder is the thread's worktree
  (`…/worktrees/thr_6z6iitf6ba-1/kai-platform`), which is the environment's
  `path`. Matching a listener to an environment by folder prefix works.
- The SDK has no API that lists processes or listening ports.
  `bb.hosts.declareSharedPorts` and `ensureSharedPortTunnel` publish named
  ports; they do not discover them.
- The plugin's server entry runs on the machine running bb and is full-trust
  Node. The page can call it with `useRpc().call(method, input)`, served by
  `bb.rpc` (SDK `PluginRpc`). Running `lsof`/`ps` and `process.kill` there is
  expected to work; not yet run from a plugin.
- Environments carry `{ id, name, path, hostId }` (`lib/hub-store.ts`). For an
  environment on another enrolled host, only an experimental `bb.host` entry
  (`experimental_defineHostEntry`, called through
  `bb.hosts.experimental_client`) runs where the process lives. Not tried.

## Consequences

Detecting detached servers on the bb host is feasible from the server entry;
other hosts need the experimental host entry. ADR 202610171641 proposes a
Services page built on this.
