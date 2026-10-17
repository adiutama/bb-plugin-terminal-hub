# Services replace the Terminals page's main view from a title-bar button, not a page of their own

- Status: accepted
- Date: 2026-10-17
- Supersedes: 202610171802
- Superseded by: none
- Applies to: docs/specs/services.md, docs/specs/session-list.md, app.tsx, components/terminals-page.tsx, components/services-page.tsx, README.md, docs/overview.md, docs/architecture.md

## Context

ADR 202610171641 (carried forward by 202610171646 and 202610171802) gave
services a second `navPanel`, "Services". Seeing it in bb, the user did not
want a second entry in bb's rail: services belong to Terminal Hub, and should
be reached from its one page, from a button in the title bar beside the close
button. They left the presentation open: a modal, replacing the main view, or
a large dropdown.

Options considered:

- **The button switches the main view to Services.** Adopted: the rail stays
  usable, nothing is covered, and the table and log drawer keep their full
  size as built.
- **A modal.** Not chosen: covers the page, and Stop's confirmation stacks a
  second overlay on it.
- **A large dropdown under the button.** Not chosen: too cramped for the log
  drawer, and dismisses on outside clicks such as Stop's confirmation.
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
   shows the number of listed services when it is above zero, and is shown
   pressed while Services is the main view. Pressing it switches the main
   view (everything right of the rail) to Services; pressing it again, or
   selecting an environment or terminal in the rail, switches back to that
   environment's terminals. The rail is unchanged.
3. **The Services view holds the table and log drawer** as ADR 202610171641
   describes them (header with title, find field and running count; grouped
   table; drawer at the bottom of the view).
4. **Refresh.** While the Services view is shown the list refreshes every 5
   seconds; otherwise, while the page is visible, the button's count
   refreshes every 30 seconds; nothing while the page is hidden.
5. **The URL does not carry the Services view**: reloading shows the
   terminals, and switching views adds no history entry.

## Consequences

- One entry in bb's rail; services are a click away from any terminal.
- A log cannot be watched beside a shell; Services and terminals take turns
  in the main view.
- `headerContent` mounts separately from the page component, so the button
  and the page share which view is shown through a module-level store;
  a throwing `headerContent` is hidden by bb without breaking the title bar.
- Specs: SVC-1, SVC-10, SVC-15 and SVC-21 change; SVC-23 is new.
  `bb terminal-hub services` and the stopping rules are unchanged.
