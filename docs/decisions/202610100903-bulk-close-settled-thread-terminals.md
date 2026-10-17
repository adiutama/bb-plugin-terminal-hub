# Offer bulk cleanup of settled threads' terminals

- Status: superseded
- Date: 2026-10-10
- Supersedes: none
- Superseded by: 202610171551
- Applies to: docs/specs/actions.md (planned)

## Context

Terminals left behind by finished threads are the main clutter the hub exists to surface.

## Decision

The environment offers "Close all from settled threads", which closes every thread terminal in the environment whose thread has settled, after confirmation.

## Consequences

Requires reliable thread state for each terminal's owner. Falls under the close-confirmation decision.
