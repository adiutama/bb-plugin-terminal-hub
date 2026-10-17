# Services open in a modal from the Terminals page, not a page of their own

- Status: proposed
- Date: 2026-10-17
- Supersedes: 202610171802
- Superseded by: none
- Applies to: docs/specs/services.md, docs/specs/session-list.md, app.tsx, components/terminals-page.tsx, components/services-page.tsx, README.md, docs/overview.md, docs/architecture.md

## Context

ADR 202610171641 (carried forward by 202610171646 and 202610171802) gave
services a second `navPanel`, "Services". Seeing it in bb, the user did not
want a second entry in bb's rail: services belong to Terminal Hub, and should
be reached from its one page. They suggested a modal.

Options considered:

- **A modal opened from the Terminals page.** Adopted, the user's suggestion:
  one rail entry, and the table-and-drawer layout stays as built. The user
  placed its button in the title bar, beside the close button, rather than in
  the page's own rail.
- **A "Services" entry in the page's own rail, showing the table in the main
  area.** Not chosen: mixes a cross-environment table into a rail of
  environments.
- **A "Services" tab per environment.** Not chosen: loses the
  all-environments overview the table was chosen for.

## Decision

ADR 202610171802 stands, except:

1. **No second `navPanel`.** The plugin registers only "Terminals".
2. **A "Services" button in the page's title bar**, on its right beside bb's
   close button, rendered through the `navPanel`'s `headerContent` slot. It
   shows the number of listed services when it is above zero, and opens a
   modal. The rail is unchanged.
3. **The modal holds the Services table and log drawer** as ADR 202610171641
   describes them (header with title, find field and running count; grouped
   table; drawer at the bottom of the modal). It is large, closes with × or
   Escape, and closing it returns focus to the button. Stop's confirmation
   opens above it.
4. **Refresh.** While the modal is open the list refreshes every 5 seconds;
   while it is closed and the page is visible, the button's count refreshes
   every 30 seconds; nothing while the page is hidden.
5. **The URL does not carry the modal**: reloading closes it, and opening or
   closing it adds no history entry.

## Consequences

- One entry in bb's rail; services are a click away from any terminal.
- The modal covers the terminal while open; it is for checking and stopping,
  not for watching a log beside a shell.
- `headerContent` mounts separately from the page component, so the button
  and the page share the modal's open state through a module-level store;
  a throwing `headerContent` is hidden by bb without breaking the title bar.
- Specs: SVC-1, SVC-10, SVC-15 and SVC-21 change; SVC-23 is new.
  `bb terminal-hub services` and the stopping rules are unchanged.
