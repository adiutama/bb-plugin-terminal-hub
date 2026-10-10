# Ship a CLI command to list running terminals

- Status: accepted
- Date: 2026-10-10
- Supersedes: none
- Superseded by: none
- Applies to: docs/specs/agent-surface.md (planned)

## Context

Agents start duplicate servers because they cannot easily see what is already running.

## Decision

The plugin adds a CLI command (for example `bb terminal-hub list --environment …`) that lists terminals the same way the hub does.

## Consequences

Agents get a cheap way to check before starting a process. The output format becomes an interface agents depend on.
