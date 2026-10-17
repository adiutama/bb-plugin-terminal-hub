# Complement BB's native terminals, do not replace them

- Status: superseded
- Date: 2026-10-10
- Supersedes: none
- Superseded by: 202610171354
- Applies to: all specs

## Context

Floating Ghostty overrode BB's terminal launcher with a DOM hack and competed with the native terminal. There is no public slot for replacing the native renderer.

## Decision

Terminal Hub is a separate page. The right sidebar and native terminal stay untouched. Ruled out: replacing BB's native terminal renderer, redirecting BB's "Start terminal" launcher, and (for now) tabs, splits, broadcast input, and a cross-project dashboard.

## Consequences

Anything ruled out here needs a superseding ADR before work starts.
