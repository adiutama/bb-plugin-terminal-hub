# Architecture

How the code is laid out and how data moves through it. The behaviour lives in
[`specs/`](specs/); this page only maps it onto files.

## Entry points

| File | Runs in | Does |
| --- | --- | --- |
| `server.ts` | bb server | Serves `ghostty-vt.wasm` to the page; registers the `bb terminal-hub` CLI. |
| `app.tsx` | bb app (browser) | Registers the Terminals `navPanel` and its title-bar count. |
| `skills/terminal-hub/SKILL.md` | agent threads | Tells agents how to run long-lived processes. |

The page talks to bb's terminals, threads, environments, and projects APIs
directly through `useSdk()`. There is no plugin RPC: the hub stores nothing
(ADR 202610101645), so a server hop would only add latency to output polling.

## Data flow

```
useSdk()  ──► lib/inventory.ts ──► lib/hub-store.ts ──► session list, header count
              (list + group)        (one store per project, for the app session)
useSdk().terminals ◄──► lib/terminal-transport.ts ◄──► lib/pump.ts ◄──► Wterm + Ghostty WASM
```

- `lib/inventory.ts` builds what the session list shows, for one environment
  or the whole project. The CLI uses the same module with `bb.sdk`, so both
  group terminals the same way.
- `lib/pump.ts` owns one terminal view: it replays scrollback, polls output
  with `sinceSeq` while visible, writes input, and resizes only while focused.

## Page and CLI modules

| File | Role |
| --- | --- |
| `lib/inventory.ts` | Lists an environment's terminals and its threads' (archived included); groups, orders, and marks stale rows. |
| `lib/hub-store.ts` | The page's data, one store per project kept for the app session: refresh cadence per view, last-known vs confirmed rows after a return, exited-row retention, server hints, home directories, actions. Also the project list. |
| `lib/page-memory.ts` | Where the user was, per project, until bb reloads: route, collapsed sections, scroll anchor, filter. |
| `lib/actions.ts` | Close (force, checked), bulk close, rename, restart, and the next selection after a close. |
| `lib/route.ts` | `subPath` ⇄ project, environment (or `all`), terminal. |
| `lib/server-hint.ts`, `lib/paths.ts`, `lib/time.ts` | Row details: server address, `~` paths, "2h". |
| `lib/terminal-transport.ts` | The pump's reads, writes, and resizes over `useSdk().terminals`. |
| `lib/cli.ts` | `bb terminal-hub list`: text and JSON over the same inventory. |
| `components/terminals-page.tsx` | Pickers, list, actions, dialogs, and the selected view; routing. |
| `components/session-list.tsx`, `components/session-row.tsx` | One environment's groups, or the sections of environments with terminals; one row. |
| `components/list-header.tsx`, `lib/all-view.ts` | The New terminal split button and summary line; which sections show, the order ACT-7 follows, and the summary counts. |
| `components/terminal-view.tsx` | Hosts one pump with find and the exit/status banner. |
| `components/header-count.tsx` | The running count in the title bar, from the store for the URL's project. |

Refresh: environment terminals send no signal, so their own lists are polled
every 5 s while the page is visible. Thread terminals follow bb's
`thread:changed` signals: `terminals-changed` lists that thread's terminals,
record changes fetch the thread, `thread-deleted` drops it, and the rest
(`events-appended` above all) is ignored. Each scope has one request in flight
and runs once more if signalled meanwhile. A full listing (the project scan in
All, the environment in a single one) runs when the view opens, on return, when
bb's realtime connection comes back, and every 2 minutes as a fallback, and
every 5 s until it succeeds. `environment:changed` reloads the environment
list. Away from the page the store stays subscribed but only marks dirty
threads. Hidden tabs do not poll.

Return: the page and the title bar take `hubStoreFor(sdk, projectId)` as they
render. Leaving the page stops the store's timers and forgets what was
confirmed, keeping the rows; coming back shows them as last known, checks the
selected terminal, then its environment, then the threads marked while away,
then scans. Every write to a list
carries the sequence number of the request (or action) that produced it, so a
late answer never replaces newer data.

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
