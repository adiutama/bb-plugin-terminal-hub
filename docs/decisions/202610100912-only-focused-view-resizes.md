# Only the focused view resizes a shared terminal

- Status: accepted
- Date: 2026-10-10
- Supersedes: none
- Superseded by: none
- Applies to: docs/specs/terminal-view.md (planned)

## Context

The same PTY may be visible in the hub and in a thread's sidebar at different sizes. If both resize it, they fight and the output reflows constantly.

## Decision

Only the view that has focus sends `resize` for a terminal.

## Consequences

An unfocused view may show the terminal at a size that does not match its own layout.
