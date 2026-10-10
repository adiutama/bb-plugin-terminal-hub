# Closing a terminal the hub did not create needs confirmation

- Status: accepted
- Date: 2026-10-10
- Supersedes: none
- Superseded by: none
- Applies to: docs/specs/actions.md (planned)

## Context

Thread terminals may be running something an agent or user still relies on, and the hub can now close them from outside the thread.

## Decision

Closing a terminal the hub did not create always asks for confirmation.

## Consequences

The hub must know which terminals it created. Bulk cleanup is covered by its own confirmation.
