# Terminal view

- Status: implemented
- Prefix: VIEW
- Decisions: 202610100910, 202610100911, 202610100912

The main area of the Terminals page: the selected terminal, live and
interactive, rendered with Ghostty's WebAssembly engine.

## Behaviour

Selecting a row shows that terminal. The view is the engine ported from
Floating Ghostty (ADR 202610100910), so typing, scrolling, search, clipboard,
and theming behave as they did there unless a rule here says otherwise.

## Rules

- **VIEW-1** The selected terminal is rendered with `@wterm/dom` and `@wterm/ghostty`, using BB's current theme and the bundled fonts. (ADR 202610100910)
- **VIEW-2** Opening a terminal first shows its recent scrollback, then follows new output using `sinceSeq`. (ADR 202610100911)
- **VIEW-3** Output is polled only while the terminal is visible. Selecting another terminal, leaving the page, or hiding the browser tab stops polling for it. (ADR 202610100911)
- **VIEW-4** The view sends `resize` only while it has focus. An unfocused view keeps the terminal's current size. (ADR 202610100912)
- **VIEW-8** When the terminal's size differs from the space available, the view renders it at the terminal's own columns and rows, anchored top-left, and leaves the rest empty.
- **VIEW-5** Keyboard input, paste, and OSC 52 clipboard writes behave as in Floating Ghostty. (ADR 202610100910)
- **VIEW-6** Find (Cmd/Ctrl+F) searches the terminal's scrollback, as in Floating Ghostty. (ADR 202610100910)
- **VIEW-7** When the terminal exits, the view shows the exit code and keeps the last output visible.

