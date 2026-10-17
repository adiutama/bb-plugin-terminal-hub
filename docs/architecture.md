# Architecture

How the code is laid out and how data moves through it. The behaviour lives in
[`specs/`](specs/); this page only maps it onto files.

## Entry points

| File | Runs in | Does |
| --- | --- | --- |
| `server.ts` | bb server | Serves `ghostty-vt.wasm` to the page; registers the `bb terminal-hub` CLI. |
| `app.tsx` | bb app (browser) | Registers the Terminals `navPanel`. |
| `skills/terminal-hub/SKILL.md` | agent threads | Tells agents how to run long-lived processes. |

The page talks to bb's terminals, threads, environments, and projects APIs
directly through `useSdk()`. There is no plugin RPC: the hub stores nothing
(ADR 202610101645), so a server hop would only add latency to output polling.

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
| `components/terminals-page.tsx` | Routing and selection, actions and dialogs, the page's shortcuts (LIST-47); lays out the rail, tabs, bar, and view. |
| `components/environment-rail.tsx` | The rail: find field, project headers with "New terminal in…", environments, keyboard, scroll memory. |
| `components/terminal-tabs.tsx` | The selected environment's tabs with their ×, and the `+` after them. |
| `components/terminal-bar.tsx` | The two-line bar above the terminal, with its actions. |
| `components/terminal-view.tsx` | Hosts one pump with find and the exit/status banner. |
| `components/empty-pane.tsx` | The pane with nothing to show, and "New terminal in…" for every project's environments. |

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

Shortcuts: while it is mounted, the page listens for `keydown` on `window` in
the capture phase, so Mod+T, Mod+W and Mod+P reach it before bb's global
shortcuts and before the terminal view; it stops them there
(`preventDefault`, `stopImmediatePropagation`). Unmounting the page removes
the listener, so elsewhere bb keeps those keys.

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
| `lib/keyboard.ts` | Keeps terminal keys from reaching bb's global shortcuts; matches the page's `/` and Mod+T, Mod+W, Mod+P. |
| `lib/pump.ts` | Replay, polling, input, focus-gated resizing, search. |
| `styles.css`, `fonts/` | Renderer CSS and the inline Nerd Font symbols fallback. |
