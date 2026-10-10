# Ship an agent skill for environment-scoped long-running processes

- Status: accepted
- Date: 2026-10-10
- Supersedes: none
- Superseded by: none
- Applies to: skills/ (planned), docs/specs/agent-surface.md (planned)

## Context

Agents start dev servers and watchers in thread-scoped terminals, which then go unnoticed after the thread settles.

## Decision

The plugin ships a skill telling agents to start long-running processes at environment scope (`bb terminal create --environment …`), so they show up in the hub and outlive the thread.

## Consequences

Agents in projects with the plugin installed change behaviour; the skill must be short and specific so it is followed.
