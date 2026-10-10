# Hub terminals use environment scope

- Status: accepted
- Date: 2026-10-10
- Supersedes: none
- Superseded by: none
- Applies to: docs/specs/session-list.md, docs/specs/actions.md (planned)

## Context

BB's native terminals belong to a thread. When a new thread starts in the same checkout or worktree, the previous thread's processes keep running but are hard to find. The SDK's `terminals.create` accepts a `thread`, `environment`, or `host_path` scope.

## Decision

Terminals created from the hub use `{ kind: "environment", environmentId }`. They are shared by every thread in that environment and outlive any one thread.

## Consequences

Long-running processes (dev servers, watchers) have an owner that matches their lifetime. The hub does not need to track which thread to attach a new terminal to. Whether environment-scoped terminals survive thread archival must be confirmed by a finding.
