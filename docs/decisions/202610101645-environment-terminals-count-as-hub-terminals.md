# Environment-scoped terminals count as hub terminals

- Status: proposed
- Date: 2026-10-10
- Supersedes: none
- Superseded by: none
- Applies to: docs/specs/actions.md

## Context

ADR 202610100913 requires confirmation before closing a terminal "the hub did
not create", so the hub must tell its own terminals apart. The SDK does not
record who created a terminal. Agents following the shipped skill
(ADR 202610100907) also create environment-scoped terminals, on purpose, so the
hub can manage them.

## Decision

A terminal counts as the hub's when it is environment-scoped, whoever created
it. Thread-scoped terminals are never the hub's. The hub stores nothing to track
ownership.

## Consequences

Closing an environment-scoped terminal an agent started needs no confirmation.
Environment scope becomes the shared, hub-managed space; the skill should say so.
If this proves too loose, a superseding ADR can add stored ownership.
