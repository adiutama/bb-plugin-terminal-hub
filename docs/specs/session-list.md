# Session list

- Status: implemented
- Prefix: LIST
- Decisions: 202610100901, 202610100902, 202610100904, 202610100911, 202610110125, 202610110156

The left column of the Terminals page: every terminal in one environment, or
in every environment of the project, grouped by who owns it, so the user can find what is running and spot what was
left behind.

## Behaviour

```
[ project      ▾ ]
[ environment  ▾ ]
[ + New terminal │ ▾ ]
[ Filter terminals, environments, threads…  / ]
3 running · 1 server · 1 stale
─────────────────────
Environment
  ● dev server   :3000
    ~/repo
From threads
  ● pnpm test          ⚠ thread idle 2h
    "Fix flaky tests" · idle
  ○ build   exit 1
    "Release prep" · archived
```

With "All environments" selected, only environments that have something to
show get a section; the rest wait behind one disclosure. Sections keep BB's
environment order.

```
[ project          ▾ ]
[ All environments ▾ ]
[ + New terminal │ ▾ ]
[ Filter terminals, environments, threads…  / ]
3 running · 1 server · 1 stale
─────────────────────
▾ main                    1 running
    Environment
      ● dev server   :3000
▾ fix-flaky-tests         2 running
    From threads
      ● pnpm test          ⚠ thread idle 2h
      ○ build   exit 1
▸ Show 37 empty environments
```

"New terminal" starts a shell in the selected environment; its ▾ opens a
"New terminal in…" menu of the project's environments, the selected one first. Until the first scan of the project's threads finishes, the list
says "Scanning threads… 12 of 80" instead of claiming nothing is running.

Typing in the filter narrows the list to the rows that match, and lists the
empty environments whose name matches, so a shell can be started there.
Typing `3000` finds the dev server; `kai flaky` finds terminals of threads
about flaky tests in the `kai` worktrees.

```
[ 3000                                       ]
3 running · 1 server · 1 stale
─────────────────────
▾ main                    1 running
    Environment
      ● dev server   :3000
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
- **LIST-2** Environment-scoped terminals appear under "Environment"; thread-scoped terminals appear under "From threads". (ADR 202610100902)
- **LIST-3** Each row under "From threads" shows the owning thread's title and its state: active, idle, error, or archived. (ADR 202610100902)
- **LIST-4** A thread terminal is stale when it is running and its thread is not active. Stale rows are highlighted and say how long ago the thread stopped being active: since `archivedAt` for archived threads, otherwise since `latestAttentionAt`. (ADR 202610100902)
- **LIST-5** Each row shows a status dot: running, or exited with its exit code. (ADR 202610100904)
- **LIST-11** When a listed terminal disappears from the SDK list because it exited, its row stays, showing the exit code, until the user dismisses it or leaves the page.
- **LIST-6** Each row shows the terminal's title and its starting directory, with the home directory shortened to `~`. (ADR 202610100904)
- **LIST-7** When recent output contains a local server address (`http://localhost:<port>`, `http://127.0.0.1:<port>`, or a `Local:` line), the row shows it as a server hint. The hint is read from the last 4 KB of output when the terminal first appears in the list, and updated while the terminal is viewed; hidden terminals are not re-read. (ADR 202610100904)
- **LIST-8** The list refreshes when BB signals that a thread changed (including `terminals-changed`), and every 5 seconds while the page is visible, so terminals created or closed elsewhere appear without a reload. (ADR 202610100911)
- **LIST-9** "New terminal" is a split button. Its main part creates an interactive shell at environment scope in the selected environment and selects it; with "All environments" selected, that is the selected terminal's environment, and with no terminal selected the main part opens the menu instead. Its ▾ part opens the "New terminal in…" menu of the project's environments: the selected environment first (with "All environments" selected, the selected terminal's environment, if any), then the rest in BB's order. Choosing one creates a shell there the same way. With "All environments" selected the view stays on All; with a single environment selected and another one chosen, the view switches to the chosen environment. (ADR 202610100901) (ADR 202610110125)
- **LIST-10** A single environment with no terminals says so once its listing has succeeded, and says it is loading before then. With nothing listed anywhere, the main pane says "No terminals found. Start one with New terminal in…", but only once the listing has succeeded (with "All environments" selected, once the list is complete under LIST-17). (ADR 202610110125)
- **LIST-12** Under "Environment", terminals are in creation order, oldest first. Under "From threads", terminals are grouped by thread, threads ordered by most recent activity, and each thread's terminals in creation order.
- **LIST-13** With "All environments" selected, the list shows a collapsible section, headed by its name and running count, for each environment that has terminals (running, or exited rows kept by LIST-11), could not be listed, or holds the selected terminal. Sections start expanded, keep BB's environment order, and each contains that environment's "Environment" and "From threads" groups. Once the list is complete (LIST-17), the other environments are hidden behind one disclosure at the bottom, "Show N empty environments" (left out when N is zero), which shows them as compact headers and then reads "Hide empty environments". The page remembers the choice only until the user leaves it. (ADR 202610110125)
- **LIST-14** With "All environments" selected, environment-scoped terminals refresh every 5 seconds; all threads' terminals are rescanned when the view opens and every 30 seconds; and a thread's terminals are refreshed at once when BB signals that they changed. (ADR 202610110125)
- **LIST-15** Clicking an environment's section header selects that environment. (ADR 202610110125)
- **LIST-16** A summary line at the top of the list reads "N running · N servers · N stale" for the selected environment, or the whole project with "All environments" selected. Servers are running terminals with a server hint (LIST-7); stale terminals are as in LIST-4. The server and stale parts are left out when zero. Clicking the stale part opens the "Close all from settled threads" confirmation (ACT-5). (ADR 202610110125)
- **LIST-17** With "All environments" selected, the list is complete once the project's environments were listed, the first full scan of its threads (LIST-14) succeeded, and every environment's own terminals were listed or failed to list (a failure shows on its section). Until then the list shows the scan's progress, as threads scanned out of the total once the total is known, and never the empty-environment disclosure or "No terminals found". If the scan fails, the list shows the error, keeps the rows it has, and the next scan tries again. (ADR 202610110125)
- **LIST-18** A filter box sits at the top of the list, above the summary line, with the placeholder "Filter terminals, environments, threads…". Empty or whitespace-only text is no filter. Otherwise the list shows only the rows that match, and leaves out group headings with no matching rows. A row matches when every whitespace-separated word of the filter appears, ignoring case, in at least one of: the terminal's title, its environment's name, its thread's title, its starting directory (as shown, or in full), or its server hint's label or address (LIST-7). The selected terminal's row is hidden like any other that does not match; the terminal stays selected and its view stays open. (ADR 202610110156)
- **LIST-19** With "All environments" selected and a filter, a section is shown only when it has matching rows or failed to list (showing its error); this replaces LIST-13's reasons, including holding the selected terminal. Shown sections are expanded whatever their collapsed state, without their collapse toggle. Once the list is complete (LIST-17), the empty-environment disclosure is replaced by the empty environments whose name matches every word of the filter, as headers under "Empty environments" that select the environment when clicked (LIST-15); until then the list shows the scan's progress as in LIST-17 and lists no empty environments. Clearing the filter restores the collapsed sections and the disclosure as they were. (ADR 202610110156)
- **LIST-20** When no row matches, the list says "No terminals match “…”.", followed by any empty environments listed under LIST-19. With "All environments" selected it says so only once the list is complete (LIST-17); in a single environment, only once its listing has succeeded, and "Loading terminals…" before then. (ADR 202610110156)
- **LIST-21** The filter's text lasts while the page stays open: it is kept when the environment changes and cleared when the project changes. The summary line (LIST-16), the title-bar count (NAV-6), and "Close all from settled threads" (ACT-5) ignore it. (ADR 202610110156)
- **LIST-22** Pressing `/` focuses the filter and selects its text when focus is inside the Terminals page but not in a text field, a terminal view, a menu, or a dialog, no Ctrl, Cmd, or Alt is held, and no input method is composing. Elsewhere `/` is left alone. In the filter, Escape clears the text; with the text already empty, it moves focus to the selected row if shown, else to the first item of the keyboard order (LIST-23), else blurs the filter. ↓ moves focus to the first item of the keyboard order. Enter selects the first row shown, or with none, the first empty environment listed under LIST-19. (ADR 202610110156)
- **LIST-23** The keyboard order is the rows the list shows, top to bottom, followed by any empty environments listed under LIST-19. With focus on a row's main button or on one of those headers, ↓ and ↑ move focus to the next and previous item without wrapping, ↑ from the first item returns focus to the filter, Home and End move to the first and last item, and Enter or Space selects it. Moving focus does not change the selection. Tab order is unchanged: every row's buttons stay in it, and keys on a row's dismiss and ⋯ buttons keep their own meaning. (ADR 202610110156)
