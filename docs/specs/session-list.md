# Session list

- Status: implemented
- Prefix: LIST
- Decisions: 202610100901, 202610100902, 202610100904, 202610100911, 202610111227

The left column of the Terminals page: every terminal in one environment, or
in every environment of the project, grouped by who owns it, so the user can find what is running and spot what was
left behind.

## Behaviour

```
kai-platform / main ▾
+ New terminal                      in main  ▾
[ Filter terminals, environments, threads   / ]
● 3 running · 1 server        Clean up 1 stale
Environment
● dev server  :3000                       ⋯
  ~/repo
From threads
● pnpm test                               ⋯
  ~/repo
  ⚠ Fix flaky tests · idle 2h ago
○ build  exit 1                         × ⋯
  ~/repo
  Release prep · archived
```

The headings appear only because this environment has both kinds of
terminal; with one kind, its rows stand alone. The ● of a stale terminal is
amber; an exited terminal's ○ is red when its exit code is not zero. A row's
× and ⋯ show on hover, on focus, and on the selected row.

With "All environments" selected, only environments that have something to
show get a section. Sections keep BB's environment order. The others are
reached through the environment picker, "New terminal in…", or the filter.

```
kai-platform / All environments ▾
+ New terminal                               ▾
[ Filter terminals, environments, threads   / ]
● 3 running · 1 server        Clean up 1 stale
⑂ main ─────────────────────────────── 1  ⌄
● dev server  :3000
  ~/repo
⑂ fix-flaky-tests ──────────────────── 2  ⌄
● pnpm test
  …
○ build  exit 1
  …
```

"New terminal" starts a shell in the selected environment; its ▾ opens a
"New terminal in…" menu of the project's environments, the selected one first. Until the first scan of the project's threads finishes, the list
says "Scanning threads… 12 of 80" instead of claiming nothing is running.

The list lasts for the app session. Leaving the page, to open a thread for
example, and coming back shows the rows it had at once, scrolled where they
were, with the same sections collapsed and the same filter, while it checks
them again:

```
Last known · 3 running · 1 server · Updating…
```

Typing in the filter narrows the list to the rows that match, and lists the
empty environments whose name matches, so a shell can be started there.
Typing `3000` finds the dev server; `kai flaky` finds terminals of threads
about flaky tests in the `kai` worktrees.

```
[ 3000                                         ]
● 3 running · 1 server        Clean up 1 stale
⑂ main ─────────────────────────────── 1
● dev server  :3000
  ~/repo
```

`/` jumps to the filter, ↓ and ↑ move through the rows, Enter opens one, and
Escape clears the filter.

The list is built from two kinds of SDK calls, because an environment-scoped
list does not include thread terminals
([finding](../findings/2026-10-10-environment-list-excludes-thread-terminals.md)):
`terminals.list` for the environment, and `terminals.list` for each thread in
the environment, archived ones included
([finding](../findings/2026-10-10-thread-terminal-lifecycle.md)).

## Rules

- **LIST-1** The list shows the terminals of the selected environment: its environment-scoped terminals plus the terminals of every thread in that environment, including archived threads. (ADR 202610100902)
- **LIST-2** Environment-scoped terminals are listed first, then thread-scoped terminals. When the rows an environment shows (after the filter, LIST-18) include both kinds, they appear under the headings "Environment" and "From threads"; when they include only one kind, the heading is left out. (ADR 202610100902) (ADR 202610111227)
- **LIST-3** Each row under "From threads" shows the owning thread's title and its state: active, idle, error, or archived. (ADR 202610100902)
- **LIST-4** A thread terminal is stale when it is running and its thread is not active. Stale rows are marked with an amber status dot and an amber warning on the thread line that gives the thread's state and how long ago it stopped being active: since `archivedAt` for archived threads, otherwise since `latestAttentionAt`. The row has no highlighted background. (ADR 202610100902) (ADR 202610111227)
- **LIST-5** Each row starts with a status dot: filled green when running, amber when stale (LIST-4), and a ring when exited, red when the exit code is not zero. An exited row also shows its exit code next to the title. (ADR 202610100904) (ADR 202610111227)
- **LIST-11** When a listed terminal disappears from the SDK list because it exited, or the terminal view sees it exit (VIEW-7), its row stays, showing the exit code, until the user dismisses it. Leaving the page and returning keeps the row; a reload drops it. A row the user dismissed or closed never comes back. (ADR 202610111227)
- **LIST-6** Each row shows the terminal's title and its starting directory, with the home directory shortened to `~`. (ADR 202610100904)
- **LIST-7** When recent output contains a local server address (`http://localhost:<port>`, `http://127.0.0.1:<port>`, or a `Local:` line), the row shows it as a server hint. The hint is read from the last 4 KB of output when the terminal first appears in the list, and updated while the terminal is viewed; hidden terminals are not re-read. (ADR 202610100904)
- **LIST-8** The list refreshes when BB signals that a thread changed (including `terminals-changed`), and every 5 seconds while the page is visible, so terminals created or closed elsewhere appear without a reload. (ADR 202610100911)
- **LIST-9** "New terminal" is a split button. Its main part creates an interactive shell at environment scope in the selected environment and selects it; with "All environments" selected, that is the selected terminal's environment, and with no terminal selected the main part opens the menu instead. The main part names the environment it will start in ("in main") when there is one. Its ▾ part opens the "New terminal in…" menu of the project's environments: the selected environment first (with "All environments" selected, the selected terminal's environment, if any), then the rest in BB's order. Choosing one creates a shell there the same way. With "All environments" selected the view stays on All; with a single environment selected and another one chosen, the view switches to the chosen environment. (ADR 202610100901) (ADR 202610111227)
- **LIST-10** A single environment with no terminals says so once its listing has succeeded since the page was opened or returned to (LIST-27), and says it is loading before then. With nothing listed anywhere, the main pane says "No terminals found. Start one with New terminal in…", but only once the listing has succeeded (with "All environments" selected, once the list is complete under LIST-17). (ADR 202610111227)
- **LIST-12** Under "Environment", terminals are in creation order, oldest first. Under "From threads", terminals are grouped by thread, threads ordered by most recent activity, and each thread's terminals in creation order.
- **LIST-13** With "All environments" selected, the list shows a collapsible section, headed by its name and running count, for each environment that has terminals (running, or exited rows kept by LIST-11), could not be listed, or holds the selected terminal. Sections start expanded, keep BB's environment order, and each contains that environment's groups (LIST-2). A section's header shows the environment's name as a button (LIST-15), its running count, which is shown even when zero and ignores the filter, and a separate collapse toggle with an expanded or collapsed state. Other environments are not listed; they are reached through the environment picker, the "New terminal in…" menu (LIST-9), and the filter (LIST-19). Collapsed sections are remembered per project until bb reloads, across leaving and returning to the page and switching projects. (ADR 202610111227)
- **LIST-14** With "All environments" selected, environment-scoped terminals refresh every 5 seconds; all threads' terminals are rescanned when the view opens and every 30 seconds; and a thread's terminals are refreshed at once when BB signals that they changed. (ADR 202610111227)
- **LIST-15** Clicking an environment's section header selects that environment. (ADR 202610111227)
- **LIST-16** A summary line at the top of the list reads "N running · N servers" for the selected environment, or the whole project with "All environments" selected. Servers are running terminals with a server hint (LIST-7); the server part is left out when zero. When there are stale terminals (LIST-4), the line ends with a button "Clean up N stale" that opens the "Close all from settled threads" confirmation (ACT-5); it is the page's only way to open it. While the rows are last known (LIST-27), the line reads "Last known · N running · N servers", followed by "Updating…", or "Reconnecting…" after a refresh failed, and offers no cleanup. (ADR 202610111227)
- **LIST-17** With "All environments" selected, the list is complete once, since the page was opened or last returned to, the project's environments were listed, a full scan of its threads (LIST-14) succeeded, and every environment's own terminals were listed or failed to list (a failure shows on its section). Until then the list never says "No terminals found". During the first scan of the project since bb loaded, the list shows the scan's progress, as threads scanned out of the total once the total is known; after a return it shows its last known rows instead (LIST-27). If the scan fails, the list shows the error, keeps the rows it has, and the next scan tries again. (ADR 202610111227)
- **LIST-18** A filter box sits at the top of the list, above the summary line, with the placeholder "Filter terminals, environments, threads…". Empty or whitespace-only text is no filter. Otherwise the list shows only the rows that match, and leaves out group headings with no matching rows. A row matches when every whitespace-separated word of the filter appears, ignoring case, in at least one of: the terminal's title, its environment's name, its thread's title, its starting directory (as shown, or in full), or its server hint's label or address (LIST-7). The selected terminal's row is hidden like any other that does not match; the terminal stays selected and its view stays open. (ADR 202610111227)
- **LIST-19** With "All environments" selected and a filter, a section is shown only when it has matching rows or failed to list (showing its error); this replaces LIST-13's reasons, including holding the selected terminal. Shown sections are expanded whatever their collapsed state, without their collapse toggle. Once the list is complete (LIST-17), the list also shows the empty environments whose name matches every word of the filter, as headers under "Empty environments" that select the environment when clicked (LIST-15); until then it shows what LIST-17 says and lists no empty environments. Clearing the filter restores the collapsed sections as they were. (ADR 202610111227)
- **LIST-20** When no row matches, the list says "No terminals match “…”.", followed by any empty environments listed under LIST-19. With "All environments" selected it says so only once the list is complete (LIST-17); in a single environment, only once its listing has succeeded (LIST-10), and "Loading terminals…" before then. (ADR 202610111227)
- **LIST-21** The filter's text is kept when the environment changes and when the user leaves the page and returns to the same project; it is cleared when the project changes, and a reload starts with an empty filter. The summary line (LIST-16), the title-bar count (NAV-6), and "Close all from settled threads" (ACT-5) ignore it. (ADR 202610111227)
- **LIST-22** Pressing `/` focuses the filter and selects its text when focus is inside the Terminals page but not in a text field, a terminal view, a menu, or a dialog, no Ctrl, Cmd, or Alt is held, and no input method is composing. Elsewhere `/` is left alone. In the filter, Escape clears the text; with the text already empty, it moves focus to the selected row if shown, else to the first item of the keyboard order (LIST-23), else blurs the filter. ↓ moves focus to the first item of the keyboard order. Enter selects the first row shown, or with none, the first empty environment listed under LIST-19. (ADR 202610111227)
- **LIST-23** The keyboard order is the rows the list shows, top to bottom, followed by any empty environments listed under LIST-19. With focus on a row's main button or on one of those headers, ↓ and ↑ move focus to the next and previous item without wrapping, ↑ from the first item returns focus to the filter, Home and End move to the first and last item, and Enter or Space selects it. Moving focus does not change the selection. Tab order is unchanged: every row's buttons stay in it, and keys on a row's dismiss and ⋯ buttons keep their own meaning. (ADR 202610111227)
- **LIST-24** A row's dismiss and ⋯ buttons are shown while the pointer is over the row, focus is within it, its menu is open, or the row is selected, and always with a coarse pointer. While hidden they keep their space, so showing them moves nothing, and they stay in the Tab order. (ADR 202610111227)
- **LIST-25** With no terminal selected, the main pane shows a terminal icon and one sentence for its state: "Select a terminal to see it here." when the list has rows; LIST-10's "No terminals found…" once the listing has succeeded with nothing listed, never on last known rows (LIST-27); "Could not list every terminal yet; trying again shortly." after a failed listing; and "Looking for terminals…" before then. With rows or with "No terminals found", and when the project has environments, it also offers a "New terminal" split button that acts as LIST-9's. With a fine pointer it lists the list's keys: `/` filter, ↑↓ move, ↵ open. A linked terminal that cannot be reached (NAV-5) shows its error and Retry instead. (ADR 202610111227)
- **LIST-26** Above the list, the project and environment pickers sit on one line as borderless triggers, project first, keeping their keyboard and touch behaviour. Below them come "New terminal" (LIST-9), the filter (LIST-18), and the summary line (LIST-16). (ADR 202610111227)
- **LIST-27** The list lasts for the app session, one per project: returning to the page shows the rows it last had at once, and a reload starts over. Rows kept from before a return are last known until the list is confirmed: with "All environments" selected, once it is complete again (LIST-17) with the environments, the full scan, and every environment's own terminals listed without a failure; in a single environment, once its listing has succeeded again (LIST-10). While the rows are last known, the summary line (LIST-16) and the title-bar count (NAV-6) say so, and nothing the list shows claims that a terminal or environment is missing: no "No terminals found", no "No terminals here yet", no "No terminals match", no empty environments (LIST-19), and no "Clean up N stale". (ADR 202610111227)
- **LIST-28** On return, when the list holds the selected terminal, it is checked before anything else. Running: its row is updated. Exited: its row stays as an exited row (LIST-11). Gone from bb: the page shows NAV-5's notice and clears the selection. Not reachable: its row and view stay, and the view shows the problem. A selected terminal the list does not hold is handled as a link (NAV-5). Then the selected environment is listed (with "All environments" selected, the selected terminal's environment's own terminals), then the full scan runs. (ADR 202610111227)
- **LIST-29** The list's scroll position is remembered per project until bb reloads. Returning to the page puts the row that was at the top of the list back where it was; if that row is gone, the list starts at the top. (ADR 202610111227)
