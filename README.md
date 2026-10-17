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

Open **Terminals** from the rail. On the left, every project lists its
environments (checkouts and worktrees) that have terminals, in bb's order and
under the project's name, as bb's own sidebar groups them. Each environment
shows its name as bb shows it (`main`, `bb/map-all-page-urls`) and how many
terminals run there. Pick one: its terminals become tabs above the terminal
view. The title bar says where you are, `project / environment`, and how many
terminals run there.

- The page opens on the environment of the thread you came from, if something
  runs there; else on the one it last showed; else on the first listed. Each
  environment remembers its last tab until bb reloads.
- Click a project's name to fold it. Point at it to show **+**: its **New
  terminal in…** menu lists every environment of the project, including the
  ones where nothing runs yet, and starts a shell there. The **+** after the
  last tab starts one in the selected environment.
- Tabs list the environment's own terminals first (the ones you start here,
  and the ones agents start for long-running processes), then the ones started
  from threads, each oldest first. A tab shows the title and, for a running
  server, its port (`:3000`). A terminal that ended keeps a dimmed tab with its
  exit code until you dismiss it.
- **Find environment** at the top of the rail narrows it to environments whose
  name, project, terminal titles, ports, or threads contain every word you
  type, so `5173` finds where vite runs. Press **/** while the page has focus
  to jump to it, **↓** to move into the rail, **Enter** to open the first
  match, and **Esc** to clear it. **⌘K** stays bb's thread switcher.
- The bar above the terminal shows its title (and exit code once it ended);
  under it, the project, environment and starting folder, the thread that owns
  it as a link (with its state when it is not active, like `idle 2h`), and the
  thread that spawned that one. On the right: the server address as a link,
  **Restart shell**, and a **⋯** menu to **Rename**, **Close** (or
  **Dismiss**), and **Close terminals from settled threads…** in this
  environment. Closing a thread's terminal asks first; the cleanup lists the
  environment again before it asks, and checks each terminal once more before
  closing it, so nothing that came back to life is closed.
- The terminal is rendered live with Ghostty's engine. Click into it to type;
  only the view you are typing in resizes the shell, so the same terminal open
  in a thread's sidebar keeps its size until then. **Cmd/Ctrl+F** searches its
  scrollback. End a shell from its view (`exit`, Ctrl-D, or Ctrl-C on its
  process) and its tab goes, with the next one selected.
- Leave the page, to open a thread for example, and come back: the rail and
  tabs are there at once, scrolled and folded as you left them, with the same
  find text. Until everything is checked again the title bar says **Last
  known**, and nothing claims a terminal is missing. A reload starts fresh.
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
