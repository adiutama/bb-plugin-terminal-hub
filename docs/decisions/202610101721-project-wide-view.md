# Offer a project-wide view of all environments, and open it by default

- Status: superseded
- Date: 2026-10-10
- Supersedes: none
- Superseded by: 202610110125
- Applies to: docs/specs/session-list.md, docs/specs/navigation.md, docs/specs/actions.md

## Context

The hub lists terminals per environment (ADR 202610100902). Users also want to
answer "what is running anywhere in this project?" to check on or close things,
without visiting each checkout and worktree. The brief left an "All
environments" option open.

The SDK has no call that lists every terminal. A project-wide list costs one
`terminals.list` per environment plus one per thread in the project, archived
threads included, because archived threads' terminals keep running
([finding](../findings/2026-10-10-thread-terminal-lifecycle.md)). Archived
threads accumulate, so a naive 5-second rescan of every thread does not scale.

## Decision

The environment picker offers **All environments**, and it is the default
selection when the URL names no environment. The All view lists every
environment in the project, each with its own "Environment" and "From threads"
groups.

The All view refreshes in tiers: environment-scoped terminals every 5 seconds;
every thread's terminals in a full scan when the view opens and every 30
seconds; and a single thread at once when BB signals that its terminals
changed.

## Consequences

- One click answers "what is running in this project"; a single environment is
  a click away.
- Terminals started in a thread can take up to 30 seconds to appear in the All
  view if BB's change signal does not fire for them.
- With All selected, the title-bar count (ADR 202610101629) and bulk cleanup
  (ADR 202610100903) cover the whole project.
- Cross-project views remain ruled out (ADR 202610100909).
