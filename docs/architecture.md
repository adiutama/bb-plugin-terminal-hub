# Architecture

How the code is laid out and how data moves through it. The behaviour lives in
[`specs/`](specs/); this page only maps it onto files.

## Entry points

| File | Runs in | Does |
| --- | --- | --- |
| `server.ts` | bb server | Serves `ghostty-vt.wasm` to the page; scans and signals processes for the Services view over plugin RPC; registers the `bb terminal-hub` CLI. |
| `app.tsx` | bb app (browser) | Registers the Terminals `navPanel`, with the Services button as its `headerContent`. |
| `skills/terminal-hub/SKILL.md` | agent threads | Tells agents how to run long-lived processes. |

The Terminals page talks to bb's terminals, threads, environments, and
projects APIs directly through `useSdk()`, with no plugin RPC: the hub stores
nothing (ADR 202610101645), so a server hop would only add latency to output
polling. The Services view has to look at processes on the machine running
bb, which only the server entry can do, so it asks the server over plugin RPC
(ADR 202610171646).

## Data flow

```
useSdk() ──► lib/inventory.ts ──► lib/hub-store.ts ──► lib/hub.ts ──► lib/rail.ts ──► rail and tabs
             (list + group)       (one store per        (every project's   (what the rail lists,
                                   project, for the      store, one         NAV-4, LIST-37)
                                   app session)          snapshot)
useSdk().terminals ◄──► lib/terminal-transport.ts ◄──► lib/pump.ts ◄──► Wterm + Ghostty WASM
```

- `lib/inventory.ts` lists an environment's terminals and groups them. The CLI
  uses the same module with `bb.sdk`, so both list terminals the same way.
- `lib/hub.ts` attaches every project's store while the page is shown and
  hands the page one snapshot of all of them.
- `lib/pump.ts` owns one terminal view: it replays scrollback, polls output
  with `sinceSeq` while visible, writes input, and resizes only while focused.

## Page and CLI modules

| File | Role |
| --- | --- |
| `lib/inventory.ts` | Lists an environment's terminals and its threads' (archived included); groups them, and orders the tabs (LIST-12). |
| `lib/hub-store.ts` | One project's data, one store per project kept for the app session: environment names (LIST-34), refresh cadence, last-known vs confirmed rows after a return, exited-row retention, server hints, home directories, actions. |
| `lib/hub.ts` | Every project's store together: attaches them all while the page is shown (the selected project first), the project list, and the snapshot the page reads. |
| `lib/rail.ts` | What the rail lists (LIST-33), what "Find environment" leaves (LIST-42), the environment the page selects on its own (NAV-4, LIST-37). |
| `lib/folders.ts`, `components/folder-states.ts` | Whether an environment's folder still exists (`hosts.directory`), checked when a "New terminal in…" menu opens and kept until bb reloads; what each menu lists (LIST-48). |
| `lib/page-memory.ts` | Where the user was until bb reloads: the environment last shown, each environment's last tab, folded projects, the rail's scroll anchor, the find text. |
| `lib/actions.ts` | Close (force, checked), rename, restart, and the next tab after a close. |
| `lib/route.ts` | `subPath` ⇄ project, environment, terminal. |
| `lib/server-hint.ts`, `lib/paths.ts`, `lib/time.ts` | Details: server address, the bar's folder and `~`, "2h". |
| `lib/terminal-transport.ts` | The pump's reads, writes, and resizes over `useSdk().terminals`. |
| `lib/cli.ts` | `bb terminal-hub list`: text and JSON over the same inventory. |
| `components/terminals-page.tsx` | Routing and selection, actions and dialogs; lays out the rail, tabs, bar, and view. |
| `components/environment-rail.tsx` | The rail: find field and its `+`, project headers with their `+`, environments, keyboard, scroll memory. |
| `components/new-terminal-menu.tsx` | "New terminal in…": a searchable list of environments for one project or all (LIST-50). |
| `components/terminal-tabs.tsx` | The selected environment's tabs with their ×, and the `+` after them. |
| `components/terminal-bar.tsx` | The two-line bar above the terminal, with its actions. |
| `components/terminal-view.tsx` | Hosts one pump with find and the exit/status banner. |
| `components/empty-pane.tsx` | The pane with nothing to show. |

Refresh: every project's store runs while the page is visible. Environment
terminals send no signal, so the selected environment's own list is polled
every 5 s, and every other environment the rail lists every 30 s. Thread
terminals follow bb's `thread:changed` signals: `terminals-changed` lists that
thread's terminals, record changes fetch the thread, `thread-deleted` drops
it, and the rest (`events-appended` above all) is ignored. Each scope has one
request in flight and runs once more if signalled meanwhile. A full listing of
each project (its environments, every thread, and every environment's own
terminals) runs when the page opens, on return, when bb's realtime connection
comes back, and every 2 minutes as a fallback, and every 5 s until it
succeeds. `environment:changed` reloads the environment list. Away from the
page the stores stay subscribed but only mark dirty threads. Hidden tabs do
not poll.

Return: the page reads `hubFor(sdk)` as it renders. Leaving
the page stops every store's timers and forgets what was confirmed, keeping the
rows; coming back shows them as last known. The store holding the selection
checks the selected terminal, then lists its environment, and opens a gate;
the other stores wait for it (at most 4 s), then fetch the threads marked
while away, then list in full. Every write to a list carries the sequence
number of the request (or action) that produced it, so a late answer never
replaces newer data.

## Services view and CLI

```
useRpc().call ──► server.ts (bb.rpc) ──► lib/services.ts ──► lib/processes.ts ──► ProcessHost
                  bb terminal-hub services ─┘   (environments,      (lsof, ps output)   (lib/process-host.ts:
                                                 threads, stops)                        execFile, fs, kill)
```

- `lib/processes.ts` reads `lsof -iTCP -sTCP:LISTEN` for listeners, `ps -A`
  for parent, process group, controlling terminal, and start time,
  `lsof -d cwd,1` for working folder and log
  file, and `ps eww` (macOS) or `/proc/<pid>/environ` (Linux) for the bb
  variables. Everything goes through a `ProcessHost`, so tests answer with
  recorded output and never touch a real process.
- bb's own processes are protected (SVC-22): the server's process, its
  ancestors, their process groups, and anything running bb's executable,
  which is the server's `process.execPath` unless that is a plain runtime such
  as `node` (then only the ancestry applies). They are never listed, and a
  group holding one, or a member with a terminal or an unreadable
  environment, is never signalled whole (SVC-19).
- `lib/services.ts` keeps the latest scan: only PIDs it listed can be signalled
  (SVC-13), and each signal re-checks the PID's start time first (SVC-8). Stop
  carries the plan the user confirmed (group or process, target, count) and
  signals nothing when it no longer matches (SVC-19). A process stopped from
  the page stays listed while it runs with the same start time, port closed or
  not, so Force stop can reach it (SVC-9). It
  names and orders environments with the Terminals page's helpers (LIST-33,
  LIST-34) and treats `system.config().primaryHostId` as this machine (SVC-11).
- The title bar's button (`headerContent`) mounts apart from the page, so the
  two share the main view and the latest list through `lib/services-store.ts`,
  never the URL. The Terminals page runs the scans: every 5 s while the
  Services view shows, every 30 s for the button's count otherwise, none while
  hidden. The terminals' selection stays in the URL meanwhile; their view
  unmounts, so nothing polls a hidden terminal. The view reads the selected
  log every 2 s while the drawer shows it.

| File | Role |
| --- | --- |
| `lib/services-contract.ts` | The RPC methods (`services.list`, `.plan`, `.stop`, `.log`) and their schemas; the page imports only its types. |
| `lib/processes.ts` | `ProcessHost`, and parsing `lsof`/`ps` output into listeners with ports, folder, log, and bb variables. |
| `lib/process-host.ts` | The real `ProcessHost`: `execFile` with argument arrays, `LC_ALL=C`, and the system folders on the lookup path. |
| `lib/services.ts` | Which listeners are listed and under which environment (SVC-2, SVC-3), thread titles, stop planning and signalling (SVC-19), log tails. |
| `lib/services-view.ts` | The find field's filter and the running count (SVC-15). |
| `lib/services-cli.ts` | `bb terminal-hub services`: text and JSON for one environment. |
| `lib/services-store.ts` | The main view (terminals or Services) and the latest list, shared by the title-bar button and the page. |
| `components/services-page.tsx` | The title-bar button, the scan cadence, and the Services view: the port-led table with its `⋯` menu, the stop confirmation, and the drawer with Open, Stop and the log (ADR 202610180433). |
| `components/ui/tooltip.tsx` | The program's full command line on hover (SVC-24). |

## Terminal engine

Ported from Floating Ghostty (ADR 202610100910). Each file keeps its upstream
behaviour unless a spec says otherwise.

| File | Role |
| --- | --- |
| `lib/ghostty.ts` | Loads the Ghostty WASM core and wraps it with compatibility guards. |
| `lib/terminal-io.ts` | Base64 and input chunking at bb's 64 KB write limit; title normalisation. |
| `lib/keys.ts` | Control codes and cursor-key sequences. |
| `lib/theme.ts` | Font stack: Nerd Fonts, bb's mono font, bundled symbols. |
| `lib/osc52-clipboard.ts` | Filters OSC 52 so terminal output cannot write the clipboard. |
| `lib/search.ts`, `components/find-bar.tsx` | Find in scrollback. |
| `lib/terminal-reset.ts` | Splits RIS resets out of the byte stream. |
| `lib/terminal-scroll.ts`, `lib/scroll.ts` | Wheel and history scrolling. |
| `lib/terminal-title.ts` | Passive OSC 0/2/7 observer. |
| `lib/terminal-presentation.ts` | Cursor shape and OSC 10/11 colour replies. |
| `lib/terminal-selection.ts` | Plain text of retained cells for select-all. |
| `lib/keyboard.ts` | Keeps terminal keys from reaching bb's global shortcuts. |
| `lib/pump.ts` | Replay, polling, input, focus-gated resizing, search. |
| `styles.css`, `fonts/` | Renderer CSS and the inline Nerd Font symbols fallback. |
