# Actions

- Status: implemented
- Prefix: ACT
- Decisions: 202610100903, 202610100905, 202610100913, 202610101645, 202610110125

What the user can do to a terminal from the hub, and the guard rails on
closing terminals that belong to someone else.

## Behaviour

Each row has a menu. The environment has one bulk action for terminals left
behind by threads.

## Rules

- **ACT-1** Each row's menu offers Rename, Restart shell, and Close. (ADR 202610100905)
- **ACT-2** Rename changes the terminal's title through the SDK, so the new title shows everywhere the terminal appears. (ADR 202610100905)
- **ACT-3** Restart shell replaces the terminal with a new interactive shell in the same scope, as BB's `restart` does; it does not re-run the original command, which the SDK does not record. (ADR 202610100905)
- **ACT-4** Closing a thread-scoped terminal asks for confirmation first, naming the terminal and its thread. Environment-scoped terminals count as the hub's and close without asking. (ADR 202610100913) (ADR 202610101645)
- **ACT-5** "Close all from settled threads" closes every running thread terminal whose thread is not active, in the selected environment or, with "All environments" selected, in the whole project, archived threads included, after one confirmation that lists each terminal with its thread. (ADR 202610100903) (ADR 202610110125)
- **ACT-6** Closing uses force mode and checks the result, because `if-clean` mode silently leaves a terminal running when it has had input ([finding](../findings/2026-10-10-cli-control-of-thread-terminals.md)).
- **ACT-7** After the selected terminal is closed or dismissed, the selection moves to the next terminal below it that the list shows, skipping rows in collapsed or hidden sections and never wrapping to the top, or else to the empty state. (ADR 202610110125)

