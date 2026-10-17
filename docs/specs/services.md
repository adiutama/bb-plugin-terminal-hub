# Services

- Status: draft
- Prefix: SVC
- Decisions: 202610171641

A page listing the servers running in bb environments' folders that are not bb
terminals, mostly ones agents started detached, so the user can see them,
open them, read their logs, and stop them.

## Behaviour

```
┌ rail ┐┌ Services ──────────────────────────────────────────────────────────┐
│  ⌂   ││ ⌄ kai-platform                                                      │
│ >_   ││   ⑂ thr_6z6iitf6ba-1                                                │
│ ⇅ ◀  ││     :55401  node …/apps/api/src/main.ts  pid 48345  2h  ↗ ⧉ log ■  │
│      ││     :55400  postgres -D …/pg              pid 33438  2h  ⧉ log ■   │
│      ││   ⑂ remote-box   not checked (other host)                           │
└──────┘└─────────────────────────────────────────────────────────────────────┘
```

↗ opens the URL, ⧉ copies, "log" shows the log file's tail, ■ stops.

## Rules

- **SVC-1** The plugin registers a `navPanel` titled "Services" at path `services`. (ADR 202610171641)
- **SVC-2** A process is listed when it listens on a TCP port and its working folder is an environment's `path` or inside it, on the machine running bb. (ADR 202610171641)
- **SVC-3** A process running in a bb terminal is not listed. (ADR 202610171641)
- **SVC-4** Each process is one row showing all its listening ports, PID, command line, and start time; rows are grouped by project and environment, ordered as the Terminals rail orders them. (ADR 202610171641)
- **SVC-5** When a process's standard output is a regular file, its row shows the file's path and a "log" action that shows the file's last 64 KB read-only, refreshed while shown. (ADR 202610171641)
- **SVC-6** "Open" opens `http://127.0.0.1:<port>` for the chosen port in a new browser tab. (ADR 202610171641)
- **SVC-7** "Copy" copies the PID, the command line, or a port. (ADR 202610171641)
- **SVC-8** "Stop" asks for confirmation, then re-checks that the PID has the start time listed; if it does, sends SIGTERM, else reports that the process changed and refreshes. (ADR 202610171641)
- **SVC-9** If a stopped process is still alive 5 seconds after SIGTERM, its row offers "Force stop", which sends SIGKILL after the same identity check. (ADR 202610171641)
- **SVC-10** The list refreshes every 5 seconds while the page is visible and not while it is hidden. (ADR 202610171641)
- **SVC-11** Environments on another host are shown as "not checked". (ADR 202610171641)
- **SVC-12** When `lsof` is not available, the page says detection is unavailable on this machine instead of an empty list. (ADR 202610171641)
- **SVC-13** The server signals only PIDs it listed in its latest scan. (ADR 202610171641)

## Open questions

- SVC-3: how to tell a process runs in a bb terminal. Candidates: its
  ancestry reaches a terminal's shell PID (needs the SDK to expose it), or
  its controlling TTY is a terminal's pty. Needs a finding.
- Whether Stop should signal the process group when the listener is a child
  of a launcher in the same folder (`npm run dev` → `node`), so the launcher
  does not respawn it.
- Whether listeners bound only to a Unix socket matter.
