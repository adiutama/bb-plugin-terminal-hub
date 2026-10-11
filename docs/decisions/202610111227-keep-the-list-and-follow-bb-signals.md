# Keep the list for the session, remember the user's place, and follow bb's signals

- Status: superseded
- Date: 2026-10-11
- Supersedes: 202610110324
- Superseded by: 202610111439
- Applies to: docs/specs/session-list.md, docs/specs/navigation.md, docs/specs/actions.md, docs/specs/terminal-view.md, lib/hub-store.ts, lib/actions.ts, lib/all-view.ts, lib/page-memory.ts, components/terminals-page.tsx, components/session-list.tsx, components/list-header.tsx, components/header-count.tsx, components/terminal-view.tsx, docs/architecture.md, README.md

## Context

Every visit to the Terminals page starts from nothing. The page builds its
store when it mounts and throws it away when it unmounts, so opening a thread
and coming back redoes the first full scan: the environments, every thread of
the project (about 80, archived ones included), and each thread's terminals.
The list says "Scanning threads… 12 of 80" for several seconds, and the
collapsed sections, the filter, the list's scroll position, and (when bb
opens the page at its root) the selected terminal are gone.

While the page is open, it refreshes a thread whenever bb says that thread
changed. About 95% of those signals are `events-appended`, one per agent
message, so a busy agent makes the page fetch the thread and its terminals
every few hundred milliseconds. The single-environment view also reloads all
of its threads every 5 seconds.

A spike ([finding](../findings/2026-10-11-realtime-signals-for-terminals.md))
recorded what bb 0.46.0 sends:

- A thread terminal sends `thread:changed` with `terminals-changed` within
  about 90 ms when it is created, exits by itself, gets input, or is closed.
  The signal carries no terminal id.
- Environment terminals send nothing; neither does output.
- A thread's `updatedAt` ignores its terminals, so it cannot drive a delta
  scan.
- Deleting a thread sends `thread-deleted`. Whether deleting a thread whose
  terminals are running also sends `terminals-changed` is untested.
- bb also sends `environment:changed` (`environment-created`,
  `environment-deleted`) and `realtime:connection` (with `reconnected`).

Options weighed:

- **Keep the store, refresh silently on return, nothing while away.** Adopted
  as the first piece.
- **Keep fetching in the background while away.** Rejected: API calls while
  the user is elsewhere. Marking changed scopes dirty while away, and fetching
  them on return, gets most of the benefit.
- **Delta scan by `updatedAt`.** Rejected: the spike shows a thread's
  `updatedAt` ignores terminals.
- **Persist a snapshot across reloads.** Not needed now; the store's data is
  kept in memory only.

## Decision

What ADR 202610110324 decided stands, except where this ADR changes it. That
includes what it carried forward from ADRs 202610110125 and 202610110156:
**All environments** is offered and is the default; sections only for
environments that have terminals, failed to list, or hold the selected
terminal, in BB's order, never sorted by activity, starting expanded; the
summary line and what it counts, with "Clean up N stale" as the only way to
the "Close all from settled threads" confirmation; "New terminal" as a split
button with "New terminal in…", naming where it starts the shell; the All
view's completeness, with scan progress until then; the next selection after
a close following the rows the user can see; the filter, what a row matches
on, sections with matches or a listing error shown expanded while filtering,
and, once the list is complete, the empty environments whose name matches;
the filter never in the URL; `/`, Escape, ↑/↓, Home/End and Enter through
the rows, added to the Tab order; the summary, title-bar count and cleanup
ignoring the filter; no empty-environment disclosure; the compact header;
ownership headings only when an environment shows both kinds; rows as
processes with a status dot and hover-revealed actions; the bar above the
terminal; the terminal's inset; and the empty main pane.

ADR 202610100911 stands: output is pulled, only for the visible terminal.

Changes, built as two pieces:

### 1. Instant return and a remembered place

1. **The list lives for the app session.** One store per project, kept
   outside the page. Leaving the page stops its timers; coming back shows the
   last known rows at once and refreshes them. A reload starts over.
2. **Coverage is kept apart from freshness.** Rows from before the return
   are shown, but until they are confirmed they never justify "No terminals
   found", "No terminals match", the empty environments the filter lists, an
   unqualified running count (in the summary line or the title bar), or
   "Clean up N stale". Instead the summary line and the title bar say "Last
   known", with "Updating…" or, when bb cannot be reached, "Reconnecting…".
   The progress line ("Scanning threads… 12 of 80") is shown only for the
   first scan of a project in the app session.
3. **The selected terminal comes first.** On return, the selected terminal is
   checked before anything else: running, exited (its row stays, with its exit
   code), gone (the "That terminal is gone" notice, as for a dead link), or
   unreachable (its row and view stay; the view shows the problem). Then the
   selected environment, then the full scan. When the terminal view sees its
   terminal exit, the list marks the row exited at once.
4. **Exited rows and dismissals last for the session.** An exited row stays
   until the user dismisses it, across leaving and returning; a dismissed or
   closed row never comes back.
5. **The page remembers where the user was, per project.** The route
   (environment and terminal), collapsed sections, list scroll position, and
   filter. The route is restored only when the page opens at its root with no
   project; an explicit URL always wins, and one project's place is never
   used for another. Scroll is restored by the row that was at the top and its
   offset, not by pixels. The filter still clears when the project changes and
   starts empty after a reload.
6. **Cleanup checks before it acts.** "Clean up N stale" refreshes the list
   before the confirmation opens, and each confirmed terminal is checked again
   just before it is closed; terminals that exited or whose thread became
   active are left alone and reported.
7. **The store follows the URL.** The page and the title bar take the store
   for the route's project as they render, so one project's rows never show
   under another.

### 2. Updates from bb's signals

1. **Only relevant thread changes are acted on.** `terminals-changed` lists
   that thread's terminals. `thread-created`, `archived-changed`,
   `status-changed`, `title-changed`, and `environment-changed` update the
   thread's record (from the signal's `statusChange` when it carries enough).
   `thread-deleted` treats the thread's terminals as gone without asking bb
   for the thread. Everything else, `events-appended` included, is ignored.
2. **One request per scope.** A thread, an environment, the environment list
   or the full scan has at most one request in flight; a signal that arrives
   meanwhile runs it once more afterwards.
3. **Subscribed while away, fetching on return.** Away from the page, the
   store keeps listening but only marks what changed. On return it fetches, in
   order: the selected terminal, the selected environment, the threads marked
   while away, then the full scan.
4. **Fallback scans.** A full scan runs on return, when bb's realtime
   connection comes back, and every 2 minutes, instead of every 30 seconds.
   Environment terminals, which send no signal, are still listed every 5
   seconds while the page is visible. `environment-created` and
   `environment-deleted` reload the environment list. While the realtime
   connection is down, the list is last known ("Reconnecting…").
5. **The single-environment view works the same way.** Its environment
   terminals every 5 seconds, its threads' terminals on their signals, and its
   full reload on return, on reconnect, and every 2 minutes, instead of
   reloading every thread every 5 seconds.

## Consequences

- Coming back to the page is instant, and the user lands where they left.
- Far fewer requests while agents are busy; thread terminal changes show
  within about a quarter second instead of up to 30 seconds.
- A missed signal leaves a thread terminal wrong until the next full scan, at
  most 2 minutes, or until the user leaves and returns.
- A store per visited project stays in memory, and subscribed, until bb
  reloads.
- Rows can be briefly out of date after a return; they say so.
- Specs: LIST-8, LIST-10, LIST-11, LIST-13, LIST-14, LIST-16, LIST-17,
  LIST-19, LIST-20, LIST-21, LIST-25, NAV-4, NAV-5, NAV-6, NAV-7, NAV-9, ACT-5
  and VIEW-7 change; LIST-27 to LIST-31 and NAV-10 are new. Rules that cite
  ADR 202610110324 cite this ADR instead.
- Piece 1 applies everything except the signal handling: LIST-8, LIST-14,
  LIST-30, LIST-31, and the reconnect parts of LIST-27 and LIST-28 come with
  piece 2.
