# Port Floating Ghostty's terminal engine

- Status: accepted
- Date: 2026-10-10
- Supersedes: none
- Superseded by: none
- Applies to: lib/, components/, tests/, fonts/ (planned)

## Context

Floating Ghostty is being deprecated because a floating window was the wrong interface, but its rendering and I/O engine holds many hard-won bug fixes.

## Decision

Port the engine: `lib/pump.ts`, `lib/ghostty.ts`, `lib/terminal-io.ts`, `lib/keys.ts`, `lib/theme.ts`, `lib/osc52-clipboard.ts`, `lib/search.ts` with `components/find-bar.tsx`, `lib/terminal-reset.ts`, `lib/terminal-scroll.ts`, `lib/terminal-title.ts`, `lib/terminal-presentation.ts`, the bundled fonts, and their tests. The renderer is `@wterm/dom` + `@wterm/ghostty` (Ghostty's WebAssembly engine; native Ghostty is not required). Reuse session rows and rename/restart/close from `terminal-sidebar.tsx` and `terminal-management.tsx` in part. Drop the floating window, the Ctrl+backtick toggle, `lib/native-launcher.ts`, and the "only terminals I created" ownership model. Environment-variable inheritance is out of scope until requested.

## Consequences

Ported files keep their behaviour unless a spec says otherwise; the commit that ports a file names its Floating Ghostty source. Floating Ghostty targeted SDK 0.4.47; this plugin targets 0.6.37, so ported code may need API updates. Ported colocated tests move to `tests/`.
