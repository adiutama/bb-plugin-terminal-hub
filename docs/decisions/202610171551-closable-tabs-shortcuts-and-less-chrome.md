# Closable tabs in creation order, terminal-manager shortcuts, and less chrome

- Status: accepted
- Date: 2026-10-17
- Supersedes: 202610171354, 202610100903
- Superseded by: none
- Applies to: docs/specs/session-list.md, docs/specs/navigation.md, docs/specs/actions.md, app.tsx, components/terminals-page.tsx, components/header-count.tsx, components/terminal-bar.tsx, lib/actions.ts, README.md

## Context

The user reviewed the built rail-and-tabs page (ADR 202610171354) in
@thread:thr_bw2fkhhrhg and asked for:

- **No title-bar count.** `skills / main · 1 running` repeats what the rail
  and the bar already say.
- **No bulk cleanup.** "Close terminals from settled threads…" in the bar's ⋯
  menu is not something they use; the hub holds a handful of terminals, closed
  one by one.
- **New tabs on the right.** A new shell landed between the environment's
  own terminals and its thread terminals (LIST-12 grouped them), not where a
  terminal app puts it.
- **A close button on every tab**, as any tab bar has.
- **The shortcuts a terminal manager has**, for new and close, and one for
  searching.
- **A way to start a shell when nothing runs anywhere.** With no environment
  listed, the rail lists no project, so no project `+` exists, yet the empty
  pane pointed to one.

bb already binds the familiar keys: `Mod+T` (new tab in the side panel),
`Mod+W` (close the panel), `Mod+P` (open a file), `Mod+K` (thread search),
`Mod+F` (find in window), `Mod+1…9` and `Mod+Shift+[ / ]` (threads). A
plugin command whose default shortcut conflicts with bb's stays unbound, so
the page cannot get these through bb's command registry. The user chose the
familiar keys for new and close, taken only while the Terminals page is
shown.

## Decision

ADR 202610171354 stands except where this ADR changes it.

1. **The title bar shows nothing of the page's.** No `headerContent`. While
   the lists are last known (LIST-27), the rail says "Updating…", or
   "Reconnecting…" while bb cannot be reached, under its find field.
2. **Tabs are in creation order, oldest first**, whatever their scope, so a
   new terminal is always the rightmost tab. `+` follows the last tab.
3. **Every tab has a close button (×).** It shows on the selected tab, on
   hover and on focus, and always with a coarse pointer, and keeps its space
   when hidden. On a running terminal it closes it, with ACT-4's confirmation
   for thread terminals; on an ended one it dismisses the tab.
4. **No bulk cleanup.** ADR 202610100903's "Close all from settled threads"
   is dropped; the ⋯ menu keeps Rename and Close.
5. **Shortcuts, while the Terminals page is shown** and no dialog or menu is
   open, focus in the terminal included: `Mod+T` starts a shell in the
   selected environment (as `+`); `Mod+W` closes or dismisses the selected
   tab (as its ×); `Mod+P` focuses "Find environment". The page takes these
   keys before bb does and only while it is shown; everywhere else they keep
   bb's meaning. `/` still focuses the find field, and `Mod+K` stays bb's.
6. **The empty page starts shells.** With no environment listed, the main
   pane offers "New terminal in…", a menu of every project's environments,
   grouped by project.

## Consequences

- One fewer place repeats the running count; the rail's counts are the only
  ones.
- Closing many terminals takes one × or `Mod+W` each; there is no way to
  close all of a settled thread's terminals at once from the hub.
- On the Terminals page, `Mod+T`, `Mod+W` and `Mod+P` no longer open bb's
  side-panel tab, close bb's panel, or open a file. Whether the page can take
  them before bb's own handler needs a live check while building; if it
  cannot, this ADR must be revisited, not worked around.
- Specs: NAV-6 and ACT-5 go; LIST-12, LIST-25, LIST-27, LIST-40, ACT-7,
  ACT-8 change; new rules for the tab close button and the shortcuts. Rules
  that cite ADR 202610171354 for behaviour this ADR keeps cite this ADR
  instead.
