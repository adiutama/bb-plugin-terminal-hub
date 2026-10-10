# Poll terminal output and pause polling for hidden terminals

- Status: accepted
- Date: 2026-10-10
- Supersedes: none
- Superseded by: none
- Applies to: docs/specs/terminal-view.md (planned)

## Context

The SDK has no push stream for output and no created or closed events (as of SDK 0.4.47; to be re-checked on 0.6.37).

## Decision

Output is pulled with `output` and `sinceSeq`. Terminals that are not visible are not polled.

## Consequences

The list must refresh on its own cadence to notice new and closed terminals. If a later SDK adds push events, supersede this decision.
