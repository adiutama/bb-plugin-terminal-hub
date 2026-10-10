# Terminal Hub — brief

> **Frozen.** This brief was the starting input for the project. Its decisions
> now live in [`decisions/`](decisions/) and its behaviour in [`specs/`](specs/);
> where they differ, those win. Do not update this file.

Starting context for `bb-plugin-terminal-hub`, distilled from the brainstorm in
@thread:thr_dh3v42ka3y (2026-10-10). This is input for the specs, not the
spec itself: decisions here can be revisited, but say so when you do.

## Pitch

BB's native terminals belong to a **thread**. Start a new thread in the same
environment and its right sidebar is empty, while the previous thread's dev
server is still running somewhere. Finding and stopping it means digging.

Terminal Hub is a dedicated page that shows terminals per **environment**
(checkout or worktree): every shell running there, who started it, and whether
that thread is still alive. It gives the user visibility and control over
whatever is running, including commands agents started.

It complements the native terminal; it does not replace or compete with it.
The right sidebar stays untouched.

## Name

- Repo / package: `bb-plugin-terminal-hub`
- Plugin id / route: `terminal-hub` → `/plugins/terminal-hub/...`
- Display name: **Terminal Hub**
- Rail label and page header: **Terminals**

The name is engine-neutral on purpose, so the renderer can change later.

## Layout (from the user's mockup)

Modelled on the Files plugin (https://github.com/abdoutelb/bb-plugin-files-editor),
which registers a `navPanel` with its own rail entry.

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

- Project picker, then environment picker (checkout or worktree), like Files.
  Possibly an "All environments" option.
- Session list for the selected environment.
- Main area: the selected session rendered with Ghostty.
- Deep links: route carries project, environment, and terminal, so reload and
  back/forward return to the same shell.

## Decisions so far

1. **Hub-created terminals use environment scope**
   (`{ kind: "environment", environmentId }`), so they are shared by every thread
   in that environment and outlive any one thread.
2. **Two groups in the list:**
   - *Environment* — the hub's long-lived shells.
   - *From threads* — terminals started from a thread's sidebar or by an agent.
     Each row shows the owning thread and its state. Highlight stale ones
     ("thread settled 2h ago, still running").
3. **Bulk cleanup:** "Close all from settled threads" for the environment, with
   confirmation.
4. **Row details:** status dot (running / exited + code), title, cwd, and a
   server hint (port or `Local: http://…` pulled from recent output).
5. **Row menu:** Rename, Restart, Close, Show in thread sidebar
   (`experimental_openTerminal` after navigating to the thread), Open in
   Ghostty.app (`bb terminal attach <id>`), as later candidates.
6. **Running-count badge** on the rail entry. Verify the host actually renders
   it; one variant is documented as accepted-but-not-mounted.
7. **Agent skill** shipped in the plugin's `skills/`: start long-running
   processes at environment scope (`bb terminal create --environment …`) so they
   show up in the hub and outlive the thread.
8. **CLI command** (e.g. `bb terminal-hub list --environment …`) so agents can
   check what is already running before starting a duplicate.

### Ruled out

- Replacing BB's native terminal renderer. There is no public slot, and the
  user prefers complementing native over competing with it.
- Redirecting BB's "Start terminal" launcher (Floating Ghostty did this with a
  DOM hack).
- Tabs, splits, broadcast input, cross-project dashboard: later, if ever.

## Rules

- **Closing a terminal the hub did not create needs confirmation.**
- **Only the focused view resizes a shared terminal.** The same PTY may be
  visible in the hub and in a thread's sidebar at different sizes.
- **Pause polling for terminals that are not visible.** Output is pulled, not
  pushed.

## SDK facts (from SDK 0.4.47 types and plugin-authoring references)

- `bb.sdk.terminals`: `list` and `create` take an explicit scope
  (`thread` / `environment` / `host_path`); `get`, `input`, `output`
  (`sinceSeq`), `resize`, `rename`, `restart`, `close` take a terminal ID.
- No push stream for output and no created/closed event found. Poll.
- No single "list all terminals" call; iterate scopes.
- `useBbNavigate().experimental_openTerminal({ terminalId })` shows a terminal
  in the current surface's right panel. On a thread surface it rejects other
  threads' terminals. Closing that tab closes the terminal.
- Plugin pages are wrapped in BB's host panel, which keeps its own Browser and
  Terminal tabs. Do not register those yourself.

## Open questions — answer with a live test before building

1. Does `terminals.list` with environment scope include terminals started from
   a thread's sidebar in that environment? If not, the hub must also list each
   of the environment's threads.
2. What happens to a thread's terminals when the thread is settled or archived?
3. Can a sidebar terminal be read, written, and closed from the CLI / SDK?

Test: the user opens a terminal in a thread's right sidebar and runs
`sleep 999`; the agent checks it with `bb terminal list --thread …`,
`--environment …`, `output`, and `send`; the user confirms the sent text appears.

## Prior art: Floating Ghostty

`~/Repositories/adiutama/bb-plugin-floating-ghostty` (project
`bb-plugin-floating-ghostty`) is the user's previous plugin. It will be
deprecated: the floating window was the wrong interface. Its engine is good.

**Port** (most of the hard-won bug fixes live here):
`lib/pump.ts`, `lib/ghostty.ts`, `lib/terminal-io.ts`, `lib/keys.ts`,
`lib/theme.ts`, `lib/osc52-clipboard.ts`, `lib/search.ts` +
`components/find-bar.tsx`, `lib/terminal-reset.ts`, `lib/terminal-scroll.ts`,
`lib/terminal-title.ts`, `lib/terminal-presentation.ts`, the bundled fonts, and
the matching tests. Renderer: `@wterm/dom` + `@wterm/ghostty` (Ghostty's
WebAssembly engine; native Ghostty is not required).

**Reuse in part:** session rows and rename/restart/close from
`components/terminal-sidebar.tsx` and `components/terminal-management.tsx`.

**Drop:** the floating window (`components/floating-terminal.tsx`, drag,
resize, recentering, overlay focus trap), the Ctrl+backtick toggle,
`lib/native-launcher.ts`, and the "only terminals I created" ownership model.
Environment-variable inheritance is a separate feature; leave it for later
unless the user asks.

Its setup (package.json, tsconfig, vitest, `scripts/smoke-live.mjs`,
`.gitignore`, commit style `feat:` / `docs:` / `chore:`) is a reasonable
starting point for this repo.

## First step: project setup

Before any feature work, set up the repository. The user's two requirements:

1. **`AGENTS.md` is the collaboration contract** between the user and agents:
   how we work together. It needs a dedicated section the user owns, where they
   write instructions that correct agent habits. Agents read it and follow it;
   they do not rewrite it.
2. **Docs are as important as code.** Treat documentation as the blueprint and
   code as what it compiles into: the spec changes first, then the code follows
   it, and the two never drift.

Everything else about the setup is to be discussed with the user.
