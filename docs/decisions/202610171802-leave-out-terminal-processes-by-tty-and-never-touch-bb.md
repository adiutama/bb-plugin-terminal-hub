# Leave out processes with a terminal, signal a group only when every member is known, and never touch bb's own processes

- Status: superseded
- Date: 2026-10-17
- Supersedes: 202610171646
- Superseded by: 202610171823
- Applies to: docs/specs/services.md, lib/services.ts, lib/processes.ts

## Context

ADR 202610171646 leaves out processes in a bb terminal by their
`BB_TERMINAL_SESSION_ID`, and lets Stop signal a launch's process group. A
review of the implementation found two ways Stop can hit the wrong process:

- macOS does not show the environment of Apple-signed programs (`/bin/zsh`,
  `/bin/sleep`, `/usr/bin/python3`) to `ps eww`; Homebrew and mise binaries
  are shown (finding 2026-10-17-what-marks-a-process-as-bb-started). A
  `python3 -m http.server` in a bb terminal is then listed, and when the
  terminal's shell leads the job's group, Stop signals the shell.
- bb's own server and host daemon listen on TCP, and the provider bridge that
  runs an agent leads that agent's process group with the environment folder
  as working folder. An environment at or above those folders lists them, and
  Stop could signal bb itself or a running agent.

bb terminal processes have a controlling terminal (TTY); the agent-started
servers probed have none.

## Decision

ADR 202610171646 stands, except:

1. **A process with a controlling terminal is not listed**, as well as one
   with `BB_TERMINAL_SESSION_ID`. Servers run in any terminal app are left
   out too; the page is for detached servers.
2. **Stop signals a whole group only when every member is known**: every
   process in the group had its environment read, none has a controlling
   terminal or `BB_TERMINAL_SESSION_ID`, and none is protected (rule 3).
   Otherwise it signals only the listener.
3. **bb's own processes are protected**: the plugin server's process, its
   ancestors, every process in their process groups, and any process running
   bb's executable are never listed and never signalled.

Approved by the user in the thread (option "TTY rule + protect bb").

## Consequences

- A server whose environment cannot be read is still found by its folder, but
  Stop reaches only the listener, so a watcher in its group may restart it.
- Servers started in Terminal.app or iTerm no longer appear.
- Specs: SVC-3 and SVC-19 change; a new rule for protected processes. Rules
  citing ADR 202610171646 cite this ADR instead.
