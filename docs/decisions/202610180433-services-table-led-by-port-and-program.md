# The Services table leads with the port and the program, and acts in the drawer

- Status: proposed
- Date: 2026-10-18
- Supersedes: 202610171823
- Superseded by: none
- Applies to: docs/specs/services.md, components/services-page.tsx, lib/services-view.ts, README.md

## Context

ADR 202610171823 put Services in the Terminals page's main view, switched
from a title-bar button. The user keeps that: a table that replaces the main
view is right. But they rejected the table as built because it did not look
intentional.

- Each row led with a raw command line cut at its end, such as
  `/Users/…/.local/share/mise/i…`. Two different node servers looked the same,
  and the part that tells them apart was cut off.
- The PID column took space on every row for a number rarely needed.
- Three unlabelled icons (open, copy, a square for stop) sat on every row.
- Column headings were in capitals, and secondary text was nearly as bright as
  primary text, so nothing stood out.

Before settling on a polished table, three other directions were sketched for
the user: tiles, a modal with a detail pane, and port chips in the title bar.
A prototype of the table below, drawn in the live page with real services,
was approved after two changes the user asked for. The program column shows
only the program's name, with the full command on hover. The thread is a
link that opens the thread.

## Decision

ADR 202610171823 stands, except for how the Services view looks:

1. **The header** shows the title "Services" and the find field. The running
   count moves out of the header, because the title-bar button already shows
   it. Find still matches the full command line and the PID.
2. **Columns are Port, Program, Started by, Up**, plus a `⋯` menu. Headings
   are in sentence case and in the subtle text colour.
   - **Port** is the row's anchor: monospace, semibold, in the foreground
     colour. Each port is a link that opens `http://127.0.0.1:<port>` in a new
     tab, with ↗ shown on hover and on the selected row.
   - **Program** is the file name of the process's executable (`node`,
     `postgres`), underlined with dots. Hovering it shows the full command
     line, wrapped.
   - **Started by** is the thread's title after a thread icon. It is a link
     that opens the thread in bb without selecting the row, underlined on
     hover.
   - **Up** is right-aligned, in the subtle colour.
   - **`⋯`** opens a menu with Copy PID, Copy command line, Copy port (one
     item per port), and Stop….
   - The PID is no longer a column.
3. **Group headers look like bb's sidebar.** Each shows a small chip with the
   project's initial, the project's name, then a branch icon and the
   environment's name in monospace, followed by a hairline to the right edge.
4. **Rows are 38 px tall.** The selected row gets a tinted background and a
   bar on its left edge, as in the rail. Secondary text uses
   `--subtle-foreground`, not `--muted-foreground`.
5. **The drawer is where you act on a service.** Its header shows the port(s),
   the program (full command line on hover), the PID, the uptime and the log
   file's name. The full path shows on hover, with a copy action. On the right
   are labelled **Open** and **Stop** buttons and ×. The log sits in a
   recessed, rounded panel inset from the drawer's edges.
6. **Stopping.** After Stop, the row's Up cell says "Stopping…". When Force
   stop is due, the row shows a labelled "Force stop" button beside its `⋯`,
   and the drawer's Stop button becomes "Force stop".

Everything else is unchanged from 202610171823: what is listed, grouping and
order, refresh, stopping rules, the URL, and the button.

## Consequences

- Rows can be told apart at a glance by port and environment. The full
  command is one hover away instead of always shown but cut short.
- Stop takes two clicks from the row (`⋯` → Stop…) or one from the drawer.
  This was chosen deliberately, so a misclick on a row can't start stopping a
  server.
- The PID is only in the drawer, the copy menu and find.
- Specs: SVC-4, SVC-5, SVC-6, SVC-7, SVC-9, SVC-14, SVC-15 and SVC-18
  change; SVC-24 (program name) is new. Every other rule is carried forward
  and re-cites this ADR. Tests for SVC-4, SVC-5, SVC-6, SVC-7, SVC-15 and
  SVC-18 need updating.
- When this is accepted, 202610171823 is marked superseded in the same commit.
