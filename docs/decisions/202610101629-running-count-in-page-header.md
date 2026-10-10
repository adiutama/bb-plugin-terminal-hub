# Show the running count in the page header, not on the rail

- Status: accepted
- Date: 2026-10-10
- Supersedes: 202610100906
- Superseded by: none
- Applies to: docs/specs/navigation.md (planned)

## Context

ADR 202610100906 put a running-count badge on the Terminals rail entry, if the
host renders one. On SDK 0.6.37 `navPanel` has no badge field, and the only
sidebar slot, `experimental_sidebarAccessory`, is documented as not mounted by
any host surface ([finding](../findings/2026-10-10-sdk-0-6-37-surface.md)).

## Decision

Show the number of running terminals in the selected environment in the page's
title bar through `headerContent`. Do not register a sidebar accessory until
the host mounts it.

## Consequences

The count is visible only while the Terminals page is open. If the host later
mounts a rail badge or sidebar accessory, a new ADR can bring it back.
