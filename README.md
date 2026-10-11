# Terminal Hub

A [BB](https://getbb.app) plugin that adds a **Terminals** page: one place to
see and control every terminal running in a checkout or worktree, whichever
thread or agent started it. It sits alongside BB's per-thread terminals and
does not replace them.

Requires bb 0.46 or later.

## Install

From a clone of this repository:

```sh
npm install
bb plugin install .
```

bb builds the page on install. A **Terminals** entry appears in the rail.

## Use

Open **Terminals** from the rail. Pick a project, then an environment (a
checkout or worktree), or keep **All environments** to see the whole project
at once; both pickers sit on one line at the top, `project / environment`.
The title bar shows how many terminals are running, and a line above the list
sums up what is running and how many are serving a local address. When
terminals were left running by threads that are no longer active, **Clean up
N stale** at the end of that line closes them, after asking.

- **All environments** shows a section only for environments that have
  terminals, running or just exited. Reach an empty one through the
  environment picker, **New terminal**'s **▾** menu, or the filter. Until the
  first scan of the project's threads finishes, the list shows its progress.
- **New terminal** starts a shell in the selected environment (in All, the
  selected terminal's), and says which one ("in main"). Its **▾** menu starts
  one in any environment of the project, including the empty ones.
- The **filter** above the list narrows it to terminals whose title,
  environment, thread, directory, or server address contains every word you
  type, so `3000` finds the dev server. Empty environments whose name matches
  are listed too. Press **/** while the page has focus to jump to it, **↓**
  and **↑** to move through the rows, **Enter** to open one, and **Esc** to
  clear the filter. The filter is not kept in the URL, so a reload starts
  with the full list.

- **Environment** lists the environment's own terminals: the ones you start
  here with **New terminal**, and the ones agents start for long-running
  processes. They are shared by every thread and outlive any one of them.
- **From threads** lists terminals started from a thread's sidebar or by an
  agent, with the thread's title and state. A terminal still running after its
  thread went idle, errored, or was archived gets an amber dot and a warning
  saying how long ago that happened. The two headings show only when an
  environment has both kinds.
- Each row starts with a status dot (green running, amber stale, a ring once
  exited, red if it failed), then its title, a local server address such as
  `:3000` when one appears in its output, the exit code once exited, and its
  starting directory.
- Select a row to see the terminal live, rendered with Ghostty's engine. Click
  into it to type; only the view you are typing in resizes the shell, so the
  same terminal open in a thread's sidebar keeps its size until then.
  **Cmd/Ctrl+F** searches its scrollback.
- The bar above the terminal shows its title and environment, a link that
  opens its server address in a new tab, **Restart shell**, and a **⋯** menu
  to **Rename** or **Close** it.
- Each row's **⋯** menu can **Rename**, **Restart shell**, or **Close** it; it
  and the row's **×** show when you point at the row, focus it, or select it,
  and always on touch screens. Closing a thread's terminal asks first.
- The URL names the project, environment, and terminal, so reloads, links, and
  back/forward return to the same shell.

Terminal Hub sits alongside bb's own terminals and leaves the thread sidebar
alone.

### For agents

The plugin ships a skill that tells agents to start dev servers and watchers
as environment terminals (`bb terminal create --environment … --title …`),
to check what is already running first, and to leave them running when done.
Agents and you can list an environment's terminals from the command line:

```sh
bb terminal-hub list                      # the calling thread's environment
bb terminal-hub list --environment env_…  # any environment
bb terminal-hub list --json               # id, title, status, scope, thread, serverHint
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
