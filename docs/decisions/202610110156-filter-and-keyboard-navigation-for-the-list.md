# Filter the list and move through it with the keyboard

- Status: accepted
- Date: 2026-10-11
- Supersedes: none
- Superseded by: none
- Applies to: docs/specs/session-list.md, docs/specs/navigation.md, docs/specs/actions.md, components/session-list.tsx, components/session-row.tsx, components/list-header.tsx, components/terminals-page.tsx, lib/all-view.ts, lib/keyboard.ts

## Context

ADR 202610110125 made the All view show only environments that have
terminals. That answers "what is running", but not "take me to that
terminal". In a project with about 40 worktrees the user still scrolls and
clicks to find a known terminal: the dev server on `:3000`, the shell in a
given worktree, the terminal an agent left in a named thread. An idle
worktree, where the user may want a new shell, is hidden behind "Show N
empty environments".

The page is in the same document as BB, which has its own key shortcuts. The
terminal view isolates its keys (`isolateTerminalKey`), and Ghostty takes
almost every key while it has focus, so a shortcut can only work while focus
is elsewhere.

Options weighed:

- **Status chips (Running / Stale / Exited).** Rejected: "stale" terminals
  are also running, so the chips overlap, and the summary line (LIST-16)
  already gives the overview.
- **Filter text in the URL.** Rejected: a reload or a shared link would open
  a list with terminals silently hidden, and every keystroke would have to
  replace the history entry (NAV-8). The filter is a quick search, not a
  place.
- **`Cmd/Ctrl+K` or `Cmd/Ctrl+F` to focus the filter.** Rejected: BB and
  the browser claim these, and `Cmd/Ctrl+F` already searches the terminal's
  scrollback.
- **`/` anywhere in the document.** Rejected: focus on the page body does not
  mean the user is on Terminal Hub, BB's own handlers see the key too, and a
  page-wide one-character shortcut needs a way to turn it off (WCAG 2.1.4).
  `/` only works while focus is inside the page.
- **A listbox with `aria-activedescendant` on the filter.** Rejected: rows
  hold buttons (dismiss, the ⋯ menu), and listbox options cannot contain
  interactive elements.
- **A roving tabindex, one row in the Tab order.** Rejected: the other rows'
  dismiss and ⋯ buttons would be reachable only by arrow keys, which screen
  readers in browse mode may take for themselves. A full grid pattern is
  more than this list needs.

## Decision

1. A filter box sits at the top of the list, with the placeholder "Filter
   terminals, environments, threads…". While it holds text, the list shows
   only the rows that match. A row matches when every word of the filter
   appears, ignoring case, in the terminal's title, its environment's name,
   its thread's title, its starting directory, or its server hint, in any
   mix of those.
2. While filtering in the All view, a section shows when it has matching
   rows or failed to list, and then expanded, whatever its collapsed state.
   Holding the selected terminal no longer keeps a section. Once the list is
   complete, the empty environments whose name matches are listed after the
   sections, so a shell can be started in an idle worktree; before then the
   scan's progress shows, never "no match". Clearing the filter brings back
   the collapsed sections and the disclosure as they were.
3. The filter lives in page state only. It survives a change of environment,
   is cleared when the project changes, and starts empty whenever the page
   opens or reloads.
4. `/` focuses the filter while focus is inside the page, unless it is in a
   text field, a terminal view, a menu, or a dialog. Escape clears the
   filter; with nothing to clear, it leaves the filter for the list.
5. ↑/↓ move focus through the rows the list shows (and the matching empty
   environments after them), Home/End jump to the ends, and Enter selects.
   ↓ from the filter enters the list, and ↑ from the first row returns to
   it. Enter in the filter selects the first row shown, or, with none, the
   first matching empty environment. The arrows add to the Tab order; they
   do not replace it, so every row's buttons stay reachable with Tab.
6. The summary line, the title-bar count, and "Close all from settled
   threads" ignore the filter; they still describe the whole environment or
   project.

## Consequences

- Jumping to a known terminal takes `/`, a few letters, and Enter.
- Moving focus does not select: the terminal view only reconnects on Enter
  or a click, so arrowing through the list stays cheap.
- With a filter, the selected terminal's row can be hidden while its view
  stays open. The next selection after a close or dismiss (ACT-7) skips rows
  the filter hides, as it skips collapsed sections.
- A reload always opens the whole list, so a filter never silently hides
  terminals on a later visit.
- Tab still visits every row's buttons; in a long list the filter and the
  arrows are the fast way through.
- Filtering is a view of the listed rows. Counts, cleanup, polling, and the
  selected terminal still use every listed terminal.
- Specs: LIST-18 to LIST-23 are new; NAV-9 says the URL does not carry the
  filter; ACT-7 skips rows the filter hides. LIST-13 is unchanged; LIST-19
  says how filtering overrides it.
