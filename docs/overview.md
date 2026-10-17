# Terminal Hub overview

BB's native terminals belong to a **thread**. Start a new thread in the same
environment and its right sidebar is empty, while the previous thread's dev
server is still running somewhere.

Terminal Hub is a page that shows terminals per **environment**: every shell
running in a checkout or worktree, who started it, and whether that thread is
still alive. It gives the user visibility and control over whatever is running,
including commands agents started. It complements BB's native terminal and
leaves the right sidebar untouched.

## Layout

```
┌ rail ┐┌ Terminals ───────────────────────────────────────────────────────┐
│  ⌂   ││ Find environment  + ││ api :8080 │ build exit 1 │ pnpm test │ +   │
│  …   ││ ⌄ kai-platform       ││ api              localhost:8080 ↗  ⟳  ⋯   │
│ >_ ◀ ││   ⑂ main          2  ││ kai-platform/billing-v2 from Ship billing │
│      ││   ⑂ billing-v2    3  ││───────────────────────────────────────────│
│      ││ ⌄ terminal-hub       ││        Ghostty terminal view              │
│      ││   ⑂ main          2  ││        (selected terminal)                │
└──────┘└──────────────────────┴┴───────────────────────────────────────────┘
```

- A rail of every project's environments that have terminals, grouped by
  project as bb's sidebar does (ADR 202610171354).
- The selected environment's terminals as tabs; the main area renders the
  selected one with Ghostty, under a bar with its details and actions.
- **Deep links**: the route carries project, environment, and terminal, so
  reload and back/forward return to the same shell.

A second page, **Services**, lists servers running in environments outside bb
terminals (ADR 202610171646): one table grouped by environment, with the
selected process's log in a drawer below it.

```
┌ Services ─────────────────────────── [Find…        ]  3 running ┐
│ PORT    PROCESS                 STARTED BY      PID     UP       │
│ kai-platform › thr_6z6iitf6ba-1                                  │
│ :55401  node apps/api/…         Map all pages   48345   2h ↗ ⧉ ■ │
├──────────────────────────────────────────────────────────────────┤
│ log tail of the selected row                                   ✕ │
└──────────────────────────────────────────────────────────────────┘
```

## Names

| Thing | Name |
| --- | --- |
| Repo and package | `bb-plugin-terminal-hub` |
| Plugin id and route | `terminal-hub`, `/plugins/terminal-hub/...` |
| Display name | Terminal Hub |
| Rail labels and page headers | Terminals, Services |

The name is engine-neutral on purpose, so the renderer can change later.

## Glossary

- **Environment**: a project checkout or worktree. Terminals are listed per
  environment, and one environment is always selected.
- **Scope**: what a terminal belongs to in the SDK: a `thread`, an
  `environment`, or a `host_path`.
- **Hub terminal**: a terminal the hub created, at environment scope. Shared by
  every thread in the environment and outlives any one thread.
- **Thread terminal**: a terminal started from a thread's sidebar or by an
  agent, at thread scope.
- **Settled thread**: a thread that has finished its work (no turn running).
- **Stale terminal**: a thread terminal still running after its thread settled.
- **Service**: a process listening on a TCP port that belongs to an
  environment by its `BB_ENVIRONMENT_ID` or its folder, and is not running in a
  bb terminal.
