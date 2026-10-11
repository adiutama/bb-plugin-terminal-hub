# Which realtime signals does bb send when terminals change?

- Date: 2026-10-11
- bb: 0.46.0
- Plugin SDK: 0.6.37

## Question

The Terminals page rescans every thread's terminals every 30 seconds and
refreshes a thread on any change to it. Could bb's realtime signals drive the
list instead? Which terminal changes produce a signal, and can a session or
thread timestamp tell the page that something happened?

## Procedure

A Node script opened `ws://127.0.0.1:<port>/ws` (the socket the bb app uses),
sent `{"type":"subscribe","target":…}` for `thread-list`, `project-list`,
`environment-list`, `host-list`, `system`, `project-detail` and
`environment-detail`, and logged every message with a timestamp. Then, about
5 seconds apart, with the bb CLI:

1. Environment-scoped terminals: create one running `sleep 600`; create one
   running `sh -c 'sleep 3; exit 2'` and let it exit; close the first.
2. On a throwaway thread (spawned, then idle): create a terminal running
   `sleep 600`; create one running `sh -c 'sleep 3; exit 2'` and let it exit;
   type `echo hi⏎` into the first; close it; create a terminal that only
   prints output, read it three times, close it.
3. Archive the thread, then delete it.

Before and after each step, `bb terminal show --json` and `bb thread show
--json` recorded the session's `updatedAt` and `lastUserInputAt` and the
thread's `updatedAt`.

## Result

| Change | Signal |
| --- | --- |
| Environment terminal created, exited by itself, closed | **None** (no thread, environment or project message). bb's server only notifies terminal changes for sessions with a `threadId` |
| Thread terminal created | `thread` `terminals-changed`, before the CLI call returned |
| Thread terminal exited by itself | `terminals-changed`, at the exit |
| Input typed into a thread terminal | `terminals-changed` (its `lastUserInputAt` changed) |
| Output only | None |
| Thread terminal closed | `terminals-changed` |
| Thread archived | `archived-changed` |
| Thread deleted | `thread-deleted` and project `threads-changed`, twice. Its terminals were already closed, so whether deleting a thread with running terminals also sends `terminals-changed` is untested |

- A session's `updatedAt` moves on create, close, exit and input, **not** on
  output. `lastUserInputAt` moves on input.
- A thread's `updatedAt` did not move when its terminals were created, used or
  closed.
- Noise: in about four minutes with two or three agents working, the log held
  281 `events-appended`, 7 `terminals-changed`, 4 `status-changed`, and a
  handful of others. Every agent message is a thread change.

Each event arrived within about 90 ms of the CLI call. The messages carry no terminal id.

Not tested: rename, restart and resize; deleting a thread whose terminals are running; behaviour across a server restart or a dropped socket, and
terminals on a remote host.

## Consequences

- Thread terminals can be driven by `terminals-changed`, plus `thread-deleted`
  (treat its terminals as gone) and `archived-changed` / `status-changed` (thread
  record only). Reacting to every thread change, as LIST-8 and LIST-14 do
  today, mostly reacts to `events-appended`.
- Environment-scoped terminals have no signal: they still need polling.
- A full scan stays needed as a fallback (start, reconnect, missed signals),
  but not every 30 seconds.
- Neither timestamp can drive a "delta scan": thread `updatedAt` ignores
  terminals.
- Output activity cannot be shown from list data: session `updatedAt` ignores
  output. ADR 202610100911 stands.
