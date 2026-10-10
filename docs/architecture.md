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
              (list + group)        (one shared store)
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
| `lib/hub-store.ts` | The page's data: refresh cadence per view, exited-row retention, server hints, home directories, actions. |
| `lib/actions.ts` | Close (force, checked), bulk close, rename, restart, and the next selection after a close. |
| `lib/route.ts` | `subPath` ⇄ project, environment (or `all`), terminal. |
| `lib/server-hint.ts`, `lib/paths.ts`, `lib/time.ts` | Row details: server address, `~` paths, "2h". |
| `lib/terminal-transport.ts` | The pump's reads, writes, and resizes over `useSdk().terminals`. |
| `lib/cli.ts` | `bb terminal-hub list`: text and JSON over the same inventory. |
| `components/terminals-page.tsx` | Pickers, list, actions, dialogs, and the selected view; routing. |
| `components/session-list.tsx`, `components/session-row.tsx` | One environment's groups, or every environment's sections; one row. |
| `components/terminal-view.tsx` | Hosts one pump with find and the exit/status banner. |
| `components/header-count.tsx` | The running count in the title bar. |

Refresh: a single environment reloads in full every 5 s while the page is
visible and on bb's `thread:changed` signal for its threads. All environments
lists each environment's own terminals every 5 s, rescans every thread every
30 s, and refreshes one thread when bb signals it changed. Hidden tabs do not
poll.

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
