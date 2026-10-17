# Actions

- Status: draft
- Prefix: ACT
- Decisions: 202610100903, 202610100905, 202610100913, 202610101645, 202610171354

What the user can do to a terminal from the hub, and the guard rails on
closing terminals that belong to someone else.

## Behaviour

The bar above the selected terminal offers the actions: Restart shell, and a
⋯ menu with Rename, Close (or Dismiss, once ended), and one bulk action for
the selected environment: "Close terminals from settled threads".

## Rules

- **ACT-2** Rename changes the terminal's title through the SDK, so the new title shows everywhere the terminal appears. (ADR 202610100905)
- **ACT-3** Restart shell replaces the terminal with a new interactive shell in the same scope, as BB's `restart` does; it does not re-run the original command, which the SDK does not record. (ADR 202610100905)
- **ACT-4** Closing a thread-scoped terminal asks for confirmation first, naming the terminal and its thread. Environment-scoped terminals count as the hub's and close without asking. (ADR 202610100913) (ADR 202610101645)
- **ACT-5** "Close terminals from settled threads…" in the bar's ⋯ menu (ACT-8) closes every running thread terminal of the selected environment whose thread is not active, archived threads included, after one confirmation that lists each terminal with its thread. The item is disabled when there is none. The environment is listed again before the confirmation opens, so it lists what is settled then; on confirm, each listed terminal is checked again just before closing, and one that is no longer running or whose thread became active is left alone and reported. (ADR 202610100903) (ADR 202610171354)
- **ACT-6** Closing uses force mode and checks the result, because `if-clean` mode silently leaves a terminal running when it has had input ([finding](../findings/2026-10-10-cli-control-of-thread-terminals.md)).
- **ACT-7** After the selected terminal is closed or dismissed, or removed because the user ended it from the view (LIST-32), the tab to its right is selected, else the tab to its left; with no tab left, the environment leaves the rail and LIST-37 selects the next one. (ADR 202610171354)
- **ACT-8** The bar above the selected terminal (VIEW-9) offers Restart shell, and a ⋯ menu with Rename, Close, and "Close terminals from settled threads…" (ACT-5). Restart, Rename and Close do what ACT-2, ACT-3, ACT-4 and ACT-6 say, with the same confirmations, and the selection then moves as ACT-7 says; Close on an ended terminal reads Dismiss and dismisses its tab (LIST-11). (ADR 202610171354)
