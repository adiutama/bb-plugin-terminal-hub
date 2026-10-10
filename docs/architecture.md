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
| `styles.css`, `fonts/` | Renderer CSS and the inline Nerd Font symbols fallback. |
