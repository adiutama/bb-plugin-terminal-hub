# Terminal Hub

A [BB](https://getbb.app) plugin that adds a **Terminals** page: one place to
see and control every terminal running in a checkout or worktree, whichever
thread or agent started it. It sits alongside BB's per-thread terminals and
does not replace them. Its **Services** view lists the servers running in your
checkouts outside bb terminals, such as ones agents started detached.

Requires bb 0.46 or later.

## Install

From a clone of this repository:

```sh
npm install
bb plugin install .
```

bb builds the page on install. A **Terminals** entry appears in the rail.

## Use

Open **Terminals** from the rail. On the left, every project lists its
environments (checkouts and worktrees) that have terminals, in bb's order and
under the project's name, as bb's own sidebar groups them. Each environment
shows its name as bb shows it (`main`, `bb/map-all-page-urls`) and how many
terminals run there. Pick one: its terminals become tabs above the terminal
view.

- The page opens on the environment of the thread you came from, if something
  runs there; else on the one it last showed; else on the first listed. Each
  environment remembers its last tab until bb reloads.
- **+** beside **Find environment** opens **New terminal in…** with every
  project's environments, including the ones where nothing runs yet (but not
  ones whose folder is gone); the page offers the same when nothing runs
  anywhere. Point at a project's name to show its own **+** for just its
  environments; click the name to fold the project. Each **New terminal in…**
  opens with a search field: type part of an environment or project name,
  move with **↑** and **↓**, and press **Enter** to start a shell there. The
  **+** after the last tab starts one in the selected environment.
- Tabs are in the order the terminals were started, so a new shell is always
  the rightmost tab, whether you, a thread, or an agent started it. A tab
  shows the title and, for a running server, its port (`:3000`). A terminal
  that ended keeps a dimmed tab with its exit code until you dismiss it.
- Each tab's **×** (on the selected tab, or when you point at one) closes the
  terminal, asking first if a thread started it; on an ended terminal it
  dismisses the tab.
- **Find environment** at the top of the rail narrows it to environments whose
  name, project, terminal titles, ports, or threads contain every word you
  type, so `5173` finds where vite runs. In it, **↓** moves into the rail,
  **Enter** opens the first match, and **Esc** clears it. The page binds no
  other keys, so ⌘T, ⌘W, ⌘P and the rest keep bb's meaning.
- The bar above the terminal shows its title (and exit code once it ended);
  under it, the project, environment and starting folder, the thread that owns
  it as a link (with its state when it is not active, like `idle 2h`), and the
  thread that spawned that one. On the right: the server address as a link,
  **Restart shell**, and a **⋯** menu to **Rename** and **Close** (or
  **Dismiss**). Closing a thread's terminal asks first.
- The terminal is rendered live with Ghostty's engine. Click into it to type;
  only the view you are typing in resizes the shell, so the same terminal open
  in a thread's sidebar keeps its size until then. **Cmd/Ctrl+F** searches its
  scrollback. End a shell from its view (`exit`, Ctrl-D, or Ctrl-C on its
  process) and its tab goes, with the next one selected.
- Leave the page, to open a thread for example, and come back: the rail and
  tabs are there at once, scrolled and folded as you left them, with the same
  find text. Until everything is checked again the rail says **Updating…**
  (or **Reconnecting…** while bb cannot be reached) under the find field, and
  nothing claims a terminal is missing. A reload starts fresh.
- The URL names the project, environment, and terminal, so reloads, links, and
  back/forward return to the same shell.

Terminal Hub sits alongside bb's own terminals and leaves the thread sidebar
alone.

### Services

Agents often start servers detached (`nohup … &`, a database's own daemon) so
they outlive the session; those never show up as terminals. Press **Services**
in the Terminals page's title bar, beside the close button, to see them in
place of the terminals (the button shows how many run): every process on this
machine that listens on a TCP port and belongs to one of your environments, either because an agent of that
environment started it (bb's `BB_ENVIRONMENT_ID` variable) or because it runs
inside the environment's folder. Processes with a terminal (a bb terminal,
Terminal.app, iTerm) are left out, and bb's own processes are never listed or
stopped.

- One table, grouped by project and environment as bb's sidebar shows them:
  each process's port (a link that opens `http://127.0.0.1:<port>`), its
  program (`node`, `postgres`; point at it for the full command line), the
  thread that started it (a link to the thread), and how long it has been up.
  **Find** narrows the rows by port, command line, PID, service or set name,
  or environment.
- Servers labelled with an *agent service record* (see below) are named by
  their role (`api  node`, `postgres  postgres`) and shown together under
  their set's title; point at the title for the case it was seeded with.
- Each row's **⋯** menu copies its PID, command line, or a port, and offers
  **Stop…**.
- Click a row to open a drawer below the table with its port, program, PID,
  uptime and log file (copy the path from there), **Open** and **Stop**
  buttons, and the log itself (the last 64 KB of the file its output goes
  to), kept at the end as it grows. **×** closes it. For a labelled server,
  a **Connect** section lists its URLs and its set's logins: passwords and
  secrets show as `••••` until you press **Show**, copying gives the full
  value, and only `http(s)` URLs on `127.0.0.1`, `localhost` or `::1` are
  links.
- Stop asks first and says how many processes it signals: a launch such as
  `npm run dev` started in its own process group is stopped as a whole, so a
  watcher cannot restart the server, when every process in it can be told
  apart; otherwise only the listener. The row then says **Stopping…**; if the
  process is still running 5 seconds later, **Force stop** (on the row and in
  the drawer) sends SIGKILL. Before any signal, the process is checked to
  still be the one listed.
- Press **Services** again, or pick an environment in the rail, to return to
  the terminals as you left them. The view is not part of the URL, so a
  reload shows the terminals.
- The list refreshes every 5 seconds while Services is shown, and the button's
  count every 30 seconds otherwise. Environments on another machine are shown
  as not checked. It needs `lsof` (macOS and Linux); without it the view says
  so.

#### Agent service records

Any tool that starts detached servers can label them so they read as a set:
each process carries `AGENT_SERVICE_RECORD` (the absolute path of the set's
`services.json`) and `AGENT_SERVICE_NAME` (its entry's `name`), and
`services.json` (version 1) holds the set's title, case and logins and, per
service, its ports, URLs and log. The record is only read when it is a
regular file you own, not a symlink, at most 64 KiB, with `version` 1;
otherwise the labels still name and group the rows. It is only ever shown:
what is listed, which log is shown, and what Stop signals never depend on it.
Processes macOS hides the environment of (Apple-signed programs such as
`/usr/bin/python3`) and Docker containers stay unlabelled.

### For agents

The plugin ships a skill that tells agents to start dev servers and watchers
as environment terminals (`bb terminal create --environment … --title …`),
to check what is already running first, to label detached servers with an
agent service record, and to leave them running when done.
Agents and you can list an environment's terminals, and the servers running
outside them, from the command line; the skill tells agents to check both
before starting a server:

```sh
bb terminal-hub list                      # the calling thread's environment
bb terminal-hub list --environment env_…  # any environment
bb terminal-hub list --json               # id, title, status, scope, thread, serverHint
bb terminal-hub services                  # what the Services view lists for it, with service names and sets
bb terminal-hub services --json           # pid, ports, command, startedAt, threadId, logPath, name, set
```

## Contributing

Read [AGENTS.md](AGENTS.md) first: it is the working agreement for people and
agents alike.

### Commands

```sh
npm install
npm run check         # Biome + typecheck + tests + check:specs; run before every commit
npm run format        # Biome: format and organize imports
npm test              # Vitest
npm run check:specs   # decisions, specs, and tests are in sync
```

```sh
npm run build         # bb plugin build: dist/ bundles, as an install builds them
npm run test:live     # smoke test against the running bb (plugin installed)
bb plugin types       # repin @get-bb/plugin-sdk and shimmed types to the installed bb
```

### Docs

| Path | Holds |
| --- | --- |
| [`docs/overview.md`](docs/overview.md) | Pitch, layout, names, glossary |
| `docs/architecture.md` | Modules and data flow (added with the first code) |
| [`docs/decisions/`](docs/decisions/) | ADRs, `YYYYMMDDHHMM-slug.md`, append-only |
| [`docs/specs/`](docs/specs/) | Behaviour per feature area, with numbered rules |
| [`docs/findings/`](docs/findings/) | Results of live tests against BB, with versions |
| [`docs/BRIEF.md`](docs/BRIEF.md) | The original brief; frozen |

Each folder has a `_template.md`. Specs move `draft` → `agreed` →
`implemented`. Each declares a unique `Prefix` and lists rules as
`- **PREFIX-1** text (ADR 202610100901)`. Rule IDs are never renumbered or reused.

`npm run check:specs` enforces this:

- ADR names, statuses, and reciprocal `Supersedes` / `Superseded by` links.
- Accepted ADRs are unchanged since acceptance (except status lines), and none
  are deleted or renamed. This needs full git history.
- Spec headers and rule lines are well formed; cited ADRs are in `Decisions` and
  accepted.
- Every rule in an `implemented` spec has a passing test, and every test ID names
  a real rule. `agreed` specs are approved but not yet required to be covered.

### Tests

Tests live in `tests/`. A test covers a rule when its title starts with the
rule's ID: `it("ACT-1: confirms before closing a thread terminal", …)`. Several
IDs are comma-separated: `it("ACT-1, ACT-2: …")`.

`check:specs` reads coverage from the Vitest JSON report that `npm test` writes
to `.cache/test-results.json`, so only tests that actually ran and passed count.
Run the full suite before it; a filtered run reports rules as untested.
Fixtures go in `tests/fixtures/`, which Vitest does not run.

### Commits

Conventional style: `feat:`, `fix:`, `test:`, `chore:`, `docs:`, with
`docs(adr):` for decisions and `docs(spec):` for specs. A commit that ports a
file from Floating Ghostty names the source file.

## License

MIT. See [LICENSE](LICENSE).
