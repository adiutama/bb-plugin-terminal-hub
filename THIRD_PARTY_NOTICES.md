# Third-party notices

## Source adaptations

The terminal engine in `lib/` and `components/find-bar.tsx` is ported from
[Floating Ghostty](https://github.com/adiutama/bb-plugin-floating-ghostty)
(ADR 202610100910), which itself adapted:

- `vburojevic/bb-plugin-floating-terminal`, version 0.5.2, commit
  `9b718642cff5de94caefecdf10151764118602bb`. MIT, copyright 2026 Vedran Burojević.
  Terminal transport, styles, and associated tests.
- `Diffuzmetall/bb-wterm-terminal-plugin`, version 0.4.0, commit
  `1438b772c0bc4bb82b48f64b7f6251ea9ee5ca23`. MIT, copyright 2026 Michael Yong.
  Ghostty guards, OSC 52 filtering, and retryable asset loading.

Both copyright notices and the MIT permission text are retained in `LICENSE`.

## Terminal engine

`@wterm/dom`, `@wterm/core`, and `@wterm/ghostty` 0.5.0 are Apache-2.0 licensed,
from https://github.com/vercel-labs/wterm. They are installed as npm dependencies;
the WASM comes directly from the pinned `@wterm/ghostty` package. The upstream
Apache license is included in `LICENSE-APACHE-2.0`.

## Fonts

The embedded Symbols Nerd Font Mono fallback is carried over from Floating
Ghostty's `fonts/` directory. Its provenance and MIT notice are in
`fonts/README.md` and `fonts/LICENSE-nerd-fonts`.
