# Tell same-named environments apart, and offer only environments whose folder exists

- Status: accepted
- Date: 2026-10-17
- Supersedes: 202610171551
- Superseded by: none
- Applies to: docs/specs/session-list.md, docs/specs/terminal-view.md, components/terminals-page.tsx, lib/hub-store.ts, README.md

## Context

In @thread:thr_bw2fkhhrhg the user found `feature/review` three times in the
`skills` project's "New terminal in…" menu. They are three bb environments
with no name of their own, on the same branch, each a temporary clone
(`/var/folders/…/T/review-pr-<random>/repo`) made by a skill-evaluation
thread. The threads are archived and the folders are gone, but bb still lists
the environments as `ready`. Any tool that clones a repository into a
temporary folder leaves the same trail, so the user wants the hub to handle
it rather than clean up by hand.

Two problems: environments that show the same name cannot be told apart, and
the menu offers environments where no shell can start. A plugin can ask
whether a folder exists on an environment's host with `files.list({ hostId,
path })`.

## Decision

ADR 202610171551 stands, with what it carried forward, except where this ADR
changes it.

1. **Same names get the folder that differs.** When environments of one
   project would show the same name, each shows it followed by the last
   segment of its path that differs from the others' (`feature/review ·
   review-pr-CuiApF`), in the rail, the "New terminal in…" menus, and the bar
   above the terminal. Environments whose name is unique in their project
   are shown as before.
2. **Menus offer only environments whose folder exists.** When a "New
   terminal in…" menu opens, the hub checks, on each environment's host,
   that the folder of every environment without terminals exists, and leaves
   out the ones whose folder is missing. A check that fails for any other
   reason keeps the environment. Results are kept until bb reloads. The rail
   needs no check: it lists only environments with terminals.

## Consequences

- Live duplicates, such as two worktrees on one branch, are told apart too.
- Environments left behind by temporary clones stop appearing in the hub,
  without deleting anything in bb. They remain in bb until someone cleans
  them up there.
- Opening a menu may cost one `files.list` per empty environment the first
  time; the menu shows that it is checking until the answers are in.
- A folder deleted after it was checked stays offered until bb reloads;
  starting a shell there fails with bb's error.
- Specs: LIST-25, LIST-34, LIST-41 and VIEW-9 change. Rules that cite ADR
  202610171551 cite this ADR instead.
