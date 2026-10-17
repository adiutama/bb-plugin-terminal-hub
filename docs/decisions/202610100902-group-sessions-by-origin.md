# Group the session list by origin

- Status: superseded
- Date: 2026-10-10
- Supersedes: none
- Superseded by: 202610171354
- Applies to: docs/specs/session-list.md (planned)

## Context

An environment can hold terminals the hub created and terminals started from a thread's sidebar or by an agent. Users need to know which ones belong to a thread that has finished.

## Decision

The list has two groups: **Environment** (the hub's long-lived shells) and **From threads** (thread-scoped terminals). Each thread row shows the owning thread and its state, and highlights stale ones, e.g. "thread settled 2h ago, still running".

## Consequences

Depends on open question 1 in the brief: if `terminals.list` with environment scope does not include thread terminals, the hub must also list each thread in the environment. A finding settles this before the session-list spec is agreed.
