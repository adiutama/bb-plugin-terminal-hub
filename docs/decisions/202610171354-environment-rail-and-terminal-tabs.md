# Navigate by environment in a rail, and show its terminals as tabs

- Status: superseded
- Date: 2026-10-17
- Supersedes: 202610111439, 202610100909, 202610100902, 202610100904, 202610101629
- Superseded by: 202610171551
- Applies to: docs/overview.md, docs/specs/session-list.md, docs/specs/navigation.md, docs/specs/actions.md, docs/specs/terminal-view.md, docs/architecture.md, lib/hub-store.ts, lib/route.ts, lib/page-memory.ts, lib/all-view.ts, lib/actions.ts, components/terminals-page.tsx, components/session-list.tsx, components/session-row.tsx, components/list-header.tsx, components/terminal-bar.tsx, components/empty-pane.tsx, components/header-count.tsx, README.md

## Context

In use, the page felt rough and noisy: five bands of controls above the first
row, the running count three times, a status dot, an age, a directory and a
thread line on every row, and two pickers that truncate. Every row asked for
the same attention, so nothing stood out. The page also opened on one
project, while bb's own sidebar shows every project, grouped by project and
then by environment.

A prototype (branch `proto/visual-direction`, @thread:thr_bw2fkhhrhg) tried
seven layouts against bb's chrome with live data. Findings:

- **The user picks a place, then a shell.** Of a flat list (Index), a
  project/environment tree, a scope rail with a list, a terminal-first tab
  strip, an ownership tree, and environments in a rail with terminals as tabs,
  the user chose the last: two dimensions instead of one long list.
- **An environment is the only useful scope.** "All terminals" and a
  project-wide tab strip overflowed and mixed environments; the user rejected
  both. Projects only group environments.
- **Empty environments are not useful in the list.** The user wants only
  places where something runs.
- **No attention styling.** The hub holds a handful of terminals, so the user
  decides by looking. Status dots, amber stale marks, banners and a "needs
  attention" group were all rejected as noise.
- **At a glance, a terminal needs its name and, for a server, its port.**
  Folder, owning thread, and the thread that spawned it belong in the bar
  above the terminal.
- **Every project costs little.** Listing every project's environments,
  threads (389 across 9 projects) and their terminals took about 1.6 s on the
  user's machine.
- **⌘K is bb's own thread switcher.** The page must not bind it.
- **Environment names are branch names.** Worktrees bb creates are named
  `bb/<slug>` (`bb/map-all-page-urls-for-the-app`); others are plain branches
  (`main`, `proto/visual-direction`). The user wants them shown as bb shows
  them, prefix included.

Options weighed and rejected in the prototype: a switcher dropdown instead of
the rail (the list is one click away; rejected), the selected environment
opening into vertical tabs in the rail (confusing), and server ports beside
each environment in the rail (breaks with many servers).

## Decision

ADR 202610100909 stands except for its "cross-project dashboard" exclusion:
the page now lists environments of every project. Tabs and splits of the same
terminal, and broadcast input, stay ruled out; terminals of one environment
shown as tabs are not that.

ADR 202610111439 stands, with what it carried forward, except where this ADR
changes it. Still in force: the store kept for the app session and the
instant return; last known rows until confirmed; the selected terminal
checked first on return; exited terminals kept until dismissed, and removed
when the user ends them from the view; bb's signals driving thread
terminals, one request per scope, and the fallback scans; nothing fetched
while away; the bar above the terminal and its inset; and close, rename,
restart and their confirmations.

ADRs 202610100902 (two ownership groups with stale highlighting), 202610100904
(row details) and 202610101629 (the running count of the selected environment
in the title bar) are replaced as follows.

1. **A rail of environments.** The left column lists bb's projects in bb's
   order, each a header that folds and unfolds, with its environments
   underneath in bb's order. Only environments with terminals (running, or
   ended and not yet dismissed) are listed; a project with none is not
   listed. Each environment shows its name and its number of running
   terminals. Names are shown as bb shows them, truncated when long, with
   the full name on hover.
2. **An environment is always selected.** There is no "All environments"
   and no project-wide view. The page opens on the environment of the thread
   bb was showing, if it has terminals; else the environment the page last
   showed; else the first listed. When the selected environment's last
   terminal goes away, the next listed environment is selected.
3. **Terminals as tabs.** The selected environment's terminals are tabs above
   the terminal view: environment terminals first, then thread terminals,
   each group in creation order. A tab shows the terminal's title and, for a
   running server, its port. An ended terminal's tab is dimmed and shows its
   exit code. There are no status dots, ages, or stale marks. Each
   environment remembers its last tab until bb reloads.
4. **Starting shells.** A `+` after the last tab starts a shell in the
   selected environment. Each project header offers, on hover or focus, a
   `+` with a "New terminal in…" menu of all its environments, empty ones
   included; it is the only place empty environments appear.
5. **The bar carries the details.** The bar above the terminal shows the
   title and exit code; the project, environment and starting folder
   (relative to the environment when inside it); the owning thread, as a
   link that opens it, with its state when not active; the thread that
   spawned it, if any; the server address as a link; and Restart shell and
   the ⋯ menu. "Close terminals from settled threads" moves into that ⋯ menu,
   for the selected environment.
6. **Finding an environment.** A field at the top of the rail narrows it to
   environments whose name, project, or terminals (title, port, owning
   thread's title) match every word typed. `/` focuses it.
7. **The title bar** shows where the user is, `project / environment`, and
   the number of running terminals in that environment.
8. **Refresh across projects.** Every project's store runs while the page is
   shown, each as ADR 202610111439 describes, except that environment
   terminals, which send no signal, are listed every 5 seconds only for the
   selected environment, and every 30 seconds for the others.

Visual details follow the prototype and are not rules: the rail at about
240 px on bb's sidebar tone; 44 px bands shared by the rail's find field and
the tab strip; environment names in monospace; 13 px regular text as in bb's
thread list; no dividers or counts on project headers.

## Consequences

- Two clicks at most reach any running terminal: an environment, then a tab.
  Nothing on screen competes for attention.
- What is running in other environments shows only as a count; their
  terminals are one click away.
- Stale terminals are no longer marked anywhere; the owning thread's state
  shows only in the bar. Cleanup is a deliberate action in the bar's menu.
- An environment with nothing running is reachable only through a project's
  "New terminal in…". Once a shell runs there, it joins the rail.
- The filter over rows, its keyboard model, the summary line, the "Last
  known" summary, collapsed sections, the "New terminal" split button, the
  environment and project pickers, and the All view's completeness rules go
  away or move into the rail. LIST-27's "last known" applies to the rail's
  counts and the tabs.
- The page now keeps every project's store attached, so the cost of a full
  scan grows with the number of projects (measured at about 1.6 s for 9).
- Specs: session-list is rewritten around the rail and tabs; navigation drops
  `all` from the URL and changes the default (NAV-4, NAV-6, NAV-7, NAV-10);
  ACT-5, ACT-7 and ACT-8 change; VIEW-9 changes. Rules that cite ADR
  202610111439 for behaviour this ADR keeps cite this ADR instead.
