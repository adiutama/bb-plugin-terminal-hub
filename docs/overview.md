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
┌ rail ┐┌ Terminals ───────────────────────────────────────────┐
│  ⌂   ││ [ project      ▾ ]  │                                 │
│  …   ││ [ environment  ▾ ]  │                                 │
│ >_ ◀ ││ ─────────────────── │        Ghostty terminal view    │
│      ││ Environment         │        (selected session)       │
│      ││   ● dev server :3000│                                 │
│      ││ From threads        │                                 │
│      ││   ● pnpm test  ⚠    │                                 │
│      ││ [ + New terminal ]  │                                 │
└──────┘└─────────────────────┴─────────────────────────────────┘
```

- A project picker, then an environment picker, as in the
  [Files plugin](https://github.com/abdoutelb/bb-plugin-files-editor), which
  registers a `navPanel` with its own rail entry. Possibly an "All environments"
  option.
- The session list for the selected environment.
- The main area renders the selected session with Ghostty.
- **Deep links**: the route carries project, environment, and terminal, so
  reload and back/forward return to the same shell.

## Names

| Thing | Name |
| --- | --- |
| Repo and package | `bb-plugin-terminal-hub` |
| Plugin id and route | `terminal-hub`, `/plugins/terminal-hub/...` |
| Display name | Terminal Hub |
| Rail label and page header | Terminals |

The name is engine-neutral on purpose, so the renderer can change later.

## Glossary

- **Environment**: a project checkout or worktree. Terminals are listed per
  environment.
- **Scope**: what a terminal belongs to in the SDK: a `thread`, an
  `environment`, or a `host_path`.
- **Hub terminal**: a terminal the hub created, at environment scope. Shared by
  every thread in the environment and outlives any one thread.
- **Thread terminal**: a terminal started from a thread's sidebar or by an
  agent, at thread scope.
- **Settled thread**: a thread that has finished its work (no turn running).
- **Stale terminal**: a thread terminal still running after its thread settled.
