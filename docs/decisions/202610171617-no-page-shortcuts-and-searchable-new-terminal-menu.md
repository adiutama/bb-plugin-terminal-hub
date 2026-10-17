# No page shortcuts, and a searchable "New terminal in…" reachable from the rail

- Status: accepted
- Date: 2026-10-17
- Supersedes: 202610171604
- Superseded by: none
- Applies to: docs/specs/session-list.md, docs/specs/actions.md, components/terminals-page.tsx, README.md

## Context

Trying the built page in bb's desktop app (@thread:thr_bw2fkhhrhg), the user
found the page's shortcuts conflicting with bb's (`Mod+T`, `Mod+W`, `Mod+P`
are bb's; ADR 202610171551 had the page take them first) and asked to remove
them, including `/` and its key hint in the find field.

They also found "New terminal in…" hard to use and hard to reach: a project
such as `kai-platform` has about 40 environments, so the menu is a long
scroll; and on the empty page the only way to start a shell sits in the main
pane while the rail is blank.

## Decision

ADR 202610171604 stands, with what it carried forward, except where this ADR
changes it.

1. **The page binds no shortcuts.** `Mod+T`, `Mod+W`, `Mod+P` and `/` are
   left to bb and the browser, and the find field shows no key hint. Arrow
   keys inside the rail and the tab strip stay: they move within a focused
   list and are not shortcuts.
2. **"New terminal in…" has a search field.** Every "New terminal in…" menu
   opens with focus in a field at its top that narrows the environments to
   those whose name (as shown, or in full) or project name contains every
   word typed. ↑ and ↓ move through the results, Enter starts a shell in the
   highlighted one, and Escape closes the menu.
3. **The rail always offers it.** A `+` beside "Find environment" opens
   "New terminal in…" for every project, grouped by project, the same menu
   the empty page offers. Project headers keep their own `+` for their
   environments.

## Consequences

- No key on the page fights bb's; starting and closing terminals is by `+`,
  ×, and the bar's menu.
- Any environment is a `+` and a few letters away, from anywhere on the page.
- Specs: LIST-44 and LIST-47 go; LIST-25 and LIST-41 change; ACT-7 and the
  actions overview drop `Mod+W`; new rules for the menu's search and the
  rail's `+`. Rules that cite ADR 202610171604 cite this ADR instead.
