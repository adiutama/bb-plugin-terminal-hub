# Focus the project-wide view on environments that have terminals

- Status: superseded
- Date: 2026-10-11
- Supersedes: 202610101721
- Superseded by: 202610110324
- Applies to: docs/specs/session-list.md, docs/specs/navigation.md, docs/specs/actions.md, components/session-list.tsx, components/terminals-page.tsx, lib/hub-store.ts

## Context

ADR 202610101721 made **All environments** the default view and listed every
environment in the project as a section. A real project has about 40
worktrees, most with no terminals. The All view then shows about 40 collapsed
"0 running" rows, and the few environments with something running are lost
among them. The question the page exists to answer, "what is running and
where", is not visible at a glance.

On opening the page, users want to see what is running, jump to a terminal,
clean up leftovers, and start a new shell. Before the first thread scan
finishes, an empty list cannot be told apart from one still loading.

Options weighed:

- **Show only environments with running terminals.** Rejected: when an
  environment's last terminal exits, the environment would vanish together
  with the exit code the user needs to see (LIST-11).
- **A flat list of terminals, sorted by activity.** Rejected: it loses the
  "Environment" / "From threads" split, and rows move under the cursor.
- **A dashboard in the main pane.** Rejected: it repeats the list, and output
  previews need extra polling (ADR 202610100911).

## Decision

The environment picker offers **All environments**, and it is the default
selection when the URL names no environment. This part of ADR 202610101721
stands, as does its refresh plan: environment-scoped terminals every 5
seconds; every thread's terminals in a full scan when the view opens and every
30 seconds; and a single thread at once when BB signals that its terminals
changed.

What the All view lists changes:

1. It lists an environment's section only when the environment has terminals
   (running, or exited rows still shown under LIST-11), failed to list, or
   holds the selected terminal. All other environments go behind one
   disclosure at the bottom, "Show N empty environments". The page remembers
   that choice only until the user leaves the page.
2. Sections keep BB's environment order. They are never sorted by activity,
   so rows do not move under the cursor.
3. A summary line at the top of the list reads "N running · N servers · N
   stale". "Stale" opens the existing "Close all from settled threads"
   confirmation (ACT-5).
4. "New terminal" becomes a split button. Its main part starts a shell in the
   selected environment in one click (in All, the selected terminal's
   environment; with none selected, it opens the menu). Its ▾ part opens "New
   terminal in…", a menu of the project's environments with the selected one
   first, so a shell can be started in a hidden, empty environment. In a
   single-environment view, choosing another environment switches the view to
   it.
5. The All view is complete only once the environment list, the first thread
   scan, and every environment's own listing have succeeded (a single
   environment's failure shows on its section). Until then the list shows the
   scan's progress, never an empty state or the empty-environment disclosure.
   Only then does the page say "No terminals found".

## Consequences

- The default view shows what is running, and leftover exited rows, without
  any expanding.
- An empty environment is a click away through the disclosure, the environment
  picker, or the "New terminal in…" menu.
- Starting a shell in the selected environment stays one click; in All with
  nothing selected, or in another environment, it takes two.
- The store has to report when the All view is complete, and how far the first
  scan has got. `loaded` only means an environment's own list was tried once.
  Overlapping scans must not mix their progress.
- Because sections can be collapsed or hidden, the next selection after a close
  or dismiss (ACT-7) follows the rows the user can see, not every listed row.
- With All selected, the title-bar count (ADR 202610101629) and bulk cleanup
  (ADR 202610100903) still cover the whole project.
- Cross-project views remain ruled out (ADR 202610100909).
- Specs: LIST-9, LIST-10 and LIST-13 change; LIST-16 (summary) and LIST-17 (scan
  progress) are new; ACT-7 follows the visible order. Rules that cite ADR
  202610101721 cite this ADR instead.
