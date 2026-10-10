# Session rows have a menu of actions

- Status: accepted
- Date: 2026-10-10
- Supersedes: none
- Superseded by: none
- Applies to: docs/specs/actions.md (planned)

## Context

Users need to manage a terminal without opening the thread that started it.

## Decision

Each row has a menu with Rename, Restart, and Close. **Later candidates**, not committed for the first release: Show in thread sidebar (navigate to the thread, then `experimental_openTerminal`) and Open in Ghostty.app (`bb terminal attach <id>`).

## Consequences

Later candidates need their own ADR or spec change before they are built.
