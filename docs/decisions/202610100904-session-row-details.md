# Session rows show status, title, cwd, and a server hint

- Status: superseded
- Date: 2026-10-10
- Supersedes: none
- Superseded by: 202610171354
- Applies to: docs/specs/session-list.md (planned)

## Context

Users scan the list to find a specific process, usually a server.

## Decision

Each row shows a status dot (running, or exited with its code), the title, the working directory, and a server hint (a port or `Local: http://…` pulled from recent output).

## Consequences

The server hint needs recent output for every listed terminal, which interacts with paused polling for hidden terminals; the spec must say how fresh the hint is.
