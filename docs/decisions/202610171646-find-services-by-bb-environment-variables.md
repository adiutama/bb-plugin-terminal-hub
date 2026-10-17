# Find services by the bb variables they inherit, show the thread that started them, and stop the launch's own group

- Status: proposed
- Date: 2026-10-17
- Supersedes: 202610171641
- Superseded by: none
- Applies to: docs/specs/services.md, docs/specs/navigation.md, docs/specs/agent-surface.md, server.ts, app.tsx, skills/terminal-hub/SKILL.md, README.md

## Context

ADR 202610171641 lists a listening process when its working folder is inside
an environment, leaves out processes running in a bb terminal without saying
how, and does not show who started a process because a reparented process
seemed impossible to attribute.

Probing real processes (finding 2026-10-17-what-marks-a-process-as-bb-started)
showed:

- Processes an agent starts inherit `BB_THREAD_ID`, `BB_ENVIRONMENT_ID` and
  `BB_PROJECT_ID` from its shell, even through `nohup setsid` and `pg_ctl`.
- Processes in a bb terminal carry `BB_TERMINAL_SESSION_ID`.
- The motivating Postgres runs with its data folder as working folder, outside
  every environment, so the folder rule misses it.
- `setsid` gives a launch its own process group holding the launcher and the
  listener; signalling only the listener lets a watcher such as `tsx watch`
  restart it.

## Decision

ADR 202610171641 stands, except:

1. **What it lists.** A process listening on a TCP port, on the machine
   running bb, that has no `BB_TERMINAL_SESSION_ID` and belongs to an
   environment: the environment named by its `BB_ENVIRONMENT_ID` when bb
   knows that environment, else the environment whose folder is its working
   folder or contains it. Processes whose environment variables cannot be
   read fall back to the folder rule.
2. **Who started it.** A process with `BB_THREAD_ID` of a thread bb knows
   shows that thread's title as a link to the thread, in a "Started by"
   column; others show nothing there.
3. **Stop signals the launch's own group.** When the listener's process
   group has no live leader, or its leader is listed or belongs to the same
   environment by rule 1, and no process in the group has
   `BB_TERMINAL_SESSION_ID`, Stop and Force stop signal the whole group;
   otherwise only the process. The confirmation names how many processes
   will be signalled.

## Consequences

- Agent-started databases and servers are found wherever their working
  folder is, and the user sees which thread to ask about them.
- Reading other processes' environments (`ps eww` on macOS,
  `/proc/<pid>/environ` on Linux) works for the user's own processes; for
  others, the folder rule is the fallback.
- Stopping `npm run dev` style launches stops the watcher too, instead of
  having it restart the server.
- Specs: SVC-2, SVC-3, SVC-4 and SVC-8 change; a rule for "Started by"; the
  open questions on SVC-3 and process groups close. Rules citing ADR
  202610171641 cite this ADR instead.
