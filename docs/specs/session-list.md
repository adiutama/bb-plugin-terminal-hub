# Session list

- Status: draft
- Prefix: LIST
- Decisions: 202610100901, 202610100902, 202610100904, 202610100911, 202610101721

The left column of the Terminals page: every terminal in one environment, or
in every environment of the project, grouped by who owns it, so the user can find what is running and spot what was
left behind.

## Behaviour

```
[ project      ▾ ]
[ environment  ▾ ]
─────────────────────
Environment
  ● dev server   :3000
    ~/repo
From threads
  ● pnpm test          ⚠ thread idle 2h
    "Fix flaky tests" · idle
  ○ build   exit 1
    "Release prep" · archived
[ + New terminal ]
```

The list is built from two kinds of SDK calls, because an environment-scoped
list does not include thread terminals
([finding](../findings/2026-10-10-environment-list-excludes-thread-terminals.md)):
`terminals.list` for the environment, and `terminals.list` for each thread in
the environment, archived ones included
([finding](../findings/2026-10-10-thread-terminal-lifecycle.md)).

## Rules

- **LIST-1** The list shows the terminals of the selected environment: its environment-scoped terminals plus the terminals of every thread in that environment, including archived threads. (ADR 202610100902)
- **LIST-2** Environment-scoped terminals appear under "Environment"; thread-scoped terminals appear under "From threads". (ADR 202610100902)
- **LIST-3** Each row under "From threads" shows the owning thread's title and its state: active, idle, error, or archived. (ADR 202610100902)
- **LIST-4** A thread terminal is stale when it is running and its thread is not active. Stale rows are highlighted and say how long ago the thread stopped being active: since `archivedAt` for archived threads, otherwise since `latestAttentionAt`. (ADR 202610100902)
- **LIST-5** Each row shows a status dot: running, or exited with its exit code. (ADR 202610100904)
- **LIST-11** When a listed terminal disappears from the SDK list because it exited, its row stays, showing the exit code, until the user dismisses it or leaves the page.
- **LIST-6** Each row shows the terminal's title and its starting directory, with the home directory shortened to `~`. (ADR 202610100904)
- **LIST-7** When recent output contains a local server address (`http://localhost:<port>`, `http://127.0.0.1:<port>`, or a `Local:` line), the row shows it as a server hint. The hint is read from the last 4 KB of output when the terminal first appears in the list, and updated while the terminal is viewed; hidden terminals are not re-read. (ADR 202610100904)
- **LIST-8** The list refreshes when BB signals that a thread changed (including `terminals-changed`), and every 5 seconds while the page is visible, so terminals created or closed elsewhere appear without a reload. (ADR 202610100911)
- **LIST-9** "New terminal" creates an interactive shell at environment scope in the selected environment and selects it. (ADR 202610100901)
- **LIST-10** An environment with no terminals shows an empty state with the "New terminal" button.
- **LIST-12** Under "Environment", terminals are in creation order, oldest first. Under "From threads", terminals are grouped by thread, threads ordered by most recent activity, and each thread's terminals in creation order.
- **LIST-13** With "All environments" selected, the list shows every environment in the project as a collapsible section headed by its name and running count, each containing that environment's "Environment" and "From threads" groups. Sections with no terminals are collapsed. (ADR 202610101721)
- **LIST-14** With "All environments" selected, environment-scoped terminals refresh every 5 seconds; all threads' terminals are rescanned when the view opens and every 30 seconds; and a thread's terminals are refreshed at once when BB signals that they changed. (ADR 202610101721)
- **LIST-15** Clicking an environment's section header selects that environment. (ADR 202610101721)

