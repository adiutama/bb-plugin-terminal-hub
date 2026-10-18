# Label services from an agent service record

- Status: proposed
- Date: 2026-10-18
- Supersedes: none
- Superseded by: none
- Applies to: docs/specs/services.md, docs/specs/agent-surface.md, lib/processes.ts, lib/services.ts, lib/services-contract.ts, lib/services-cli.ts, components/services-page.tsx, skills/terminal-hub/SKILL.md, README.md

## Context

The Services view (ADR 202610180433) infers each server's environment,
starting thread, ports and log, but not what the server is for: two `node`
rows look alike, a set's API and database are not shown as one set, and the
database URL and the seeded login live only in the starting agent's notes.

With the user (@thread:thr_az68mkr9p9) we agreed a small, tool-neutral
contract, the **agent service record** version 1, now produced by the
throwaway-services skill 1.1.0 and specified in that skill's
`references/record.md`:

- every process a producer starts carries `AGENT_SERVICE_RECORD` (absolute
  path of the set's `services.json`) and `AGENT_SERVICE_NAME` (its entry's
  `name`, e.g. `api`, `postgres`);
- `services.json` holds the set's title, case and credentials, and per service
  its name, kind, ports, URLs and log.

Rejected with the user: starting services in bb terminals (databases keep
`BB_TERMINAL_SESSION_ID` and SVC-3 hides them), a copyable set-stop command,
and listing Docker-run services.

## Decision

1. **Labels group and name rows.** Rows whose processes have the same
   `AGENT_SERVICE_RECORD` form a set, shown together under a set row inside
   their environment group. A labelled row is named by its
   `AGENT_SERVICE_NAME` (`api`), with the program (`node`) beside it. This
   holds even when the record cannot be read; the set row then shows the
   record's folder name.
2. **The record adds detail, for display only.** When the record passes the
   consumer checks of record version 1 (absolute path, regular file, not a
   symlink, owned by the user, ≤ 64 KiB, valid JSON, `version` 1), the set
   row shows its `title`, with `case` on hover, and the drawer gains a
   Connect section: the service's URLs and the set's credentials.
3. **Secrets stay masked.** Credential secrets and URL passwords show as
   `••••` with a Show toggle; copying gives the full value. Only `http(s)`
   URLs on `127.0.0.1`, `localhost` or `::1` are links; others are
   copy-only. All strings are plain text.
4. **Nothing in the record is acted on.** Stop, the log shown, and what is
   listed are unchanged (SVC-2, SVC-5, SVC-8, SVC-19); the record never
   decides what to run, signal, read or delete.
5. **Find** also matches service names, set titles and cases.
6. **Agents.** `bb terminal-hub services` prints each process's name and
   set title, and `--json` adds `name` and `set` (`record`, `id`, `title`).
   Neither prints URLs or credentials: agents read the record themselves.
   The shipped skill tells agents that start detached servers to label them
   with this contract.

## Consequences

- A set reads as one unit (`api`, `postgres` under its title), and the
  logins needed to try it by hand are a click away.
- Terminal Hub depends on a documented, versioned contract, not on one
  skill's prose; any tool can produce it. A version other than 1 is treated
  as unreadable, so labels still apply.
- Processes started before the producer adopted the contract, Docker
  containers, and Apple-signed programs (whose environment macOS hides) stay
  unlabelled and look as they do today.
- Specs: SVC-15 and SVC-24 change, SVC-5 gains the Connect section, new
  rules for sets, record checks, masking and links; AGENT-7 and AGENT-8
  change and a skill rule is added.
