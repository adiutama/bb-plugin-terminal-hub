# Terminal view

- Status: draft
- Prefix: VIEW
- Decisions: 202610100910, 202610100911, 202610100912, 202610171354

The main area of the Terminals page: the selected terminal, live and
interactive, rendered with Ghostty's WebAssembly engine.

## Behaviour

Selecting a tab shows that terminal, under a bar with its title and actions,
inset from the pane's edges. The view is the engine ported from
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
- **VIEW-7** When the terminal exits, the view shows the exit code and keeps the last output visible, and its tab is marked ended at once (LIST-11); when the user ended it from the view, its tab is removed instead (LIST-32). (ADR 202610171354)
- **VIEW-9** A bar above the selected terminal shows, on its first line, the terminal's title and, once it has exited, its exit code; on its second line, the project and environment, the starting folder (relative to the environment's path when inside it, left out when it is that path, with the home directory as `~` otherwise), the owning thread as "from <title>", a link that opens the thread, followed by its state when not active ("idle 2h", "archived"), and "spawned by <title>" when that thread has a parent thread. At its right are the server hint (LIST-7) as a link and the actions of ACT-8. The bar sits outside the terminal view, so keys pressed in it never reach the shell. The link opens the hint's address in a new browser tab, only for `http` and `https` addresses, and says that the address was read from recent output. (ADR 202610171354)
- **VIEW-10** The terminal is inset from the pane's edges, about 14px above and below and 16px at the sides. The inset lies outside the element the view measures, so the columns and rows it fits (VIEW-4) and the space it anchors to (VIEW-8) are those inside the inset. (ADR 202610171354)
