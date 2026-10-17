# Remove a terminal the user ends from its view

- Status: superseded
- Date: 2026-10-11
- Supersedes: 202610111227
- Superseded by: 202610171354
- Applies to: docs/specs/session-list.md, docs/specs/terminal-view.md, docs/specs/actions.md, lib/pump.ts, components/terminal-view.tsx, components/terminals-page.tsx, README.md

## Context

ADR 202610111227 keeps every exited terminal as a row, with its exit code and
last output, until the user dismisses it, across leaving and returning to the
page. That is right for a dev server that crashed or a command that finished
while nobody watched: the row is how the user notices.

It is wrong for a shell the user just ended on purpose. Typing `exit` (or
Ctrl-D, or Ctrl-C on the terminal's own process) in the hub's view leaves an
"exit 130" row selected, with the dead shell still on screen, and the user has
to dismiss it by hand. The exit code says nothing about intent: a shell exits
with the status of its last command, so `exit` after a Ctrl-C reports 130.

Options weighed:

- **Remove only exit code 0.** Rejected: misses the common case above (130),
  and removes finished commands the user may want to see.
- **Remove any exit while the terminal is shown.** Rejected: a crash while the
  user watches would vanish with its output.
- **Remove every exited terminal.** Rejected: loses crash reports entirely.
- **Remove a terminal that ends right after the user typed into its view.**
  Adopted: typing in the view is the user acting on that terminal; an exit
  moments later is theirs.

## Decision

What ADR 202610111227 decided stands, including everything it carried forward
from ADRs 202610110324, 202610110125 and 202610110156, except where this ADR
changes it.

When the terminal shown in the view ends within 5 seconds of the user typing
into that view, whatever its exit code, its row is removed as if the user had
dismissed it, and the selection moves to the next row the list shows, as
after a close. A terminal that ends any other way (on its own, from elsewhere,
or without recent typing in the view) keeps its exited row until dismissed, as
before.

## Consequences

- Ending a shell from the hub takes one step instead of two.
- A process the user's typing kills within 5 seconds (Ctrl-C on a dev server,
  say) also loses its row and output. That is the user's own act, in front of
  them.
- Specs: LIST-11, VIEW-7 and ACT-7 change; LIST-32 is new. Rules that cite ADR
  202610111227 cite this ADR instead.
