# Show the list as a process list, and give the terminal a bar of its own

- Status: superseded
- Date: 2026-10-11
- Supersedes: 202610110125, 202610110156
- Superseded by: 202610111227
- Applies to: docs/specs/session-list.md, docs/specs/actions.md, docs/specs/terminal-view.md, docs/specs/navigation.md, components/list-header.tsx, components/session-list.tsx, components/session-row.tsx, components/terminals-page.tsx, components/terminal-bar.tsx, components/empty-pane.tsx, lib/all-view.ts, lib/keyboard.ts, README.md

## Context

ADR 202610110125 made the All view show only environments that have
terminals, with the rest behind "Show N empty environments". In use, the page
still reads like a form: five full-width bordered controls before any
content, "N running" three times, stale cleanup offered twice (the summary's
"N stale" and a footer button), up to four text lines per row, every row's ⋯
always visible, and a loud amber background on stale rows. The terminal's
text touches the pane's edge, and the selected terminal has no title or
actions near it.

The empty-environment disclosure duplicates three other ways to reach an
empty environment: the environment picker, the "New terminal in…" menu
(LIST-9), and the filter, which lists empty environments whose name matches
(LIST-19, ADR 202610110156).

The page sits inside bb, next to bb's thread sidebar. It should feel at home
there without looking like a copy of the thread list: threads are
conversations, shown as cards; terminals are processes, shown as dense rows.

Options weighed:

- **Group by state (Running / Stale / Exited), like bb's Active / Parked /
  Settled.** Rejected: a stale terminal is also running, so the groups
  overlap, and rows would jump between groups when they exit, which ADR
  202610110125 already rejected.
- **Flatten ownership: drop the "Environment" / "From threads" grouping and
  mark owners with an icon.** Rejected: it contradicts ADR 202610100902.
- **Tabs attached to the terminal pane.** Rejected for now: a bolder change
  with more layout risk; the process list answers the feedback.
- **A list/detail layout for narrow screens.** Deferred to its own decision.

## Decision

What ADR 202610110125 decided stands, except where this ADR changes it:
**All environments** is offered and is the default; the refresh plan
(environment terminals every 5 seconds, a full thread scan when the view opens
and every 30 seconds, one thread at once when BB signals its terminals
changed); sections only for environments that have terminals, failed to
list, or hold the selected terminal, in BB's order, never sorted by activity,
starting expanded, with their collapsed state kept until the user leaves the
page; the summary line and what it counts; "New terminal" as a split button
with "New terminal in…"; the All view's completeness, with scan progress
until then; and the next selection after a close following the rows the user
can see.

What ADR 202610110156 decided stands too, except for the disclosure: the
filter and what a row matches on; sections with matches or a listing error
shown expanded while filtering, and, once the list is complete, the empty
environments whose name matches; the filter kept in page state only, never in
the URL; `/` to focus it while focus is in the page, Escape to clear and leave
it; ↑/↓, Home/End and Enter through the rows, added to the Tab order rather
than replacing it; and the summary, title-bar count and cleanup ignoring the
filter.

Changes:

1. **No empty-environment disclosure.** Environments without a section are
   not listed. They stay reachable through the environment picker, "New
   terminal in…", and the filter. Clearing the filter brings back the
   collapsed sections as they were, and nothing else.
2. **A compact header.** Project and environment pickers sit on one line,
   `project / environment ▾`, as borderless triggers of the same pickers.
   "New terminal" is a quiet row that names where it will start the shell
   ("in main"), still a split button with "New terminal in…". The filter is
   a lightly filled box.
3. **Cleanup lives in the summary line.** The summary reads "N running · N
   servers", and, when there are stale terminals, ends with an action "Clean
   up N stale" that opens the existing "Close all from settled threads"
   confirmation (ACT-5). The footer button goes.
4. **Ownership headings only when needed.** "Environment" and "From threads"
   headings appear only in an environment that has both kinds among the rows
   shown. Environment terminals still come first; thread rows still name
   their thread. A section's header shows the environment's name (which
   selects it), its running count, and a separate collapse toggle.
5. **Rows read as processes.** A status dot leads each row: green running,
   amber stale, a ring when exited, red when the exit code is non-zero. The
   server hint and the exit code are small monospace labels by the title; the
   directory is monospace. A stale row is marked by its dot and an amber
   warning on its thread line, not a row background. A row's dismiss and ⋯
   buttons show on hover, on focus within the row, while its menu is open,
   and on the selected row; on touch screens they always show. Hidden, they
   keep their space and their place in the Tab order.
6. **A bar above the terminal.** The selected terminal gets a thin bar,
   outside the terminal so its keys never reach the shell: title and
   environment, the exit code once exited, the server hint as a link that
   opens the address in a new browser tab, Restart shell, and a ⋯ menu with
   Rename and Close. The actions are the row menu's, with the same
   confirmations. The server hint is read from output, not checked, and the
   link says so.
7. **The terminal is inset from the pane edges.** The inset sits outside the
   element the view measures, so the columns and rows it fits stay right.
8. **An empty main pane that helps.** An icon, the existing state-specific
   sentence, a "New terminal" button when the list has loaded, and, with a
   mouse or trackpad, the keys that work: `/` filter, ↑↓ move, ↵ open.

Visual details (sizes, colours, motion) follow the prototype and are not
rules: section names in monospace with a branch icon, a hairline rule and a
muted count, the chevron on the right; 120–150 ms fades and rotations with
no animated heights, off under `prefers-reduced-motion`; tabular numerals.

## Consequences

- Less chrome above the list, one place for cleanup, and the terminal's
  actions where the eye already is. The bar costs about 36px of terminal
  height.
- An empty environment is two clicks away (picker, or "New terminal in…"), or
  `/` and a few letters.
- Row actions are hidden until wanted on a fine pointer; keyboard and touch
  users still reach them as before.
- Keyboard behaviour (LIST-22, LIST-23) and the next selection after a close
  (ACT-7) do not change.
- Specs: LIST-2, LIST-4, LIST-5, LIST-9, LIST-13, LIST-16, LIST-17, LIST-19
  and ACT-5 change; LIST-24, LIST-25, LIST-26, ACT-8, VIEW-9 and VIEW-10 are
  new. Rules that cite ADR 202610110125 or ADR 202610110156 cite this ADR
  instead.
- The terminal's inset follows the prototype: about 14px above and below,
  16px at the sides.
