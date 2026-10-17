# A Services page lists servers running in environment folders outside bb terminals

- Status: accepted
- Date: 2026-10-17
- Supersedes: none
- Superseded by: none
- Applies to: docs/specs/services.md, docs/specs/navigation.md, docs/specs/agent-surface.md, server.ts, app.tsx, skills/terminal-hub/SKILL.md, README.md

## Context

Agents often start servers detached (`nohup … &`, `setsid`, self-daemonizing
databases) so they outlive the session. The user's `/throwaway-services` skill
does this by design. Such processes are not bb terminals, so the Terminals
page never shows them, and the user cannot see or stop what agents left
running (finding 2026-10-17-detached-servers-and-host-processes).

The user wants the Terminals page to keep listing bb terminals only, and a
separate page for running services agents start. A process cannot be
attributed to an agent once it is reparented, so "started by an agent" is
approximated by where it runs: inside a bb environment's folder.

The SDK has no process or port API. The plugin's server entry is full-trust
Node on the machine running bb and the page can call it over plugin RPC;
code on other enrolled hosts needs the experimental `bb.host` entry.

Options considered for what counts as a service:

- **Any listener whose working folder is inside an environment.** Adopted:
  catches dev servers and databases however they were started, with little
  noise.
- **Also long-running processes without a port.** Rejected for now: editors,
  language servers and file watchers in the same folders would bury the
  servers.
- **Only processes recorded in a registry agents write.** Rejected: sees only
  agents that follow one convention.

Options considered for the layout:

- **A table with a log drawer.** Adopted by the user: every port across all
  environments at a glance, with the log a click away.
- **A list with a detail pane, like the Terminals page.** Rejected: a service
  has little to show besides its log, and one-at-a-time hides the overview.
- **A card per environment.** Rejected: least dense, and the log needs a
  modal.

## Decision

1. **A second page, "Services".** The plugin registers a second `navPanel`,
   "Services" at path `services`. The Terminals page is unchanged.
2. **What it lists.** A process listening on a TCP port whose working folder
   is an environment's folder or inside it, on the machine running bb, and
   that is not running in a bb terminal. One row per process, with all its
   ports.
3. **Its own layout: a table with a log drawer.** Not the Terminals page's
   rail and tabs: services are short rows to scan and compare (which ports
   are taken, what is still up), not shells to work in. The page is one
   full-width table with a header holding a find field and the running
   count. Columns: port(s), process (command line), PID, uptime, actions.
   Rows are grouped under a header row per environment, `project ›
   environment`, ordered as the Terminals rail orders environments.
   Selecting a row opens a drawer along the bottom of the page with that
   process's log tail and its log path; one drawer at a time, closed with ×.
   The table stays visible above it.
4. **Actions.** Open `http://127.0.0.1:<port>` in the browser; copy PID,
   command line or port; view the log file's tail in the drawer, read-only,
   refreshed while shown; Stop. Stop asks for confirmation, re-checks that
   the PID still has the same start time, and sends SIGTERM; if the process
   is still alive after a few seconds it offers Force stop (SIGKILL).
5. **Detection runs in the server entry** with `lsof` and `ps`, called from
   the page over plugin RPC, and refreshes on a timer only while the page is
   visible (as ADR 202610100911 does for output).
6. **Other hosts are not checked yet.** Environments on another enrolled host
   are listed as not checked. Support through the `bb.host` entry is a later
   decision.
7. **Agents can see it too.** `bb terminal-hub services` lists the same
   processes, with `--json`, and the shipped skill tells agents to check it,
   as well as `bb terminal-hub list`, before starting a server.

## Consequences

- Detached servers agents leave behind become visible and stoppable without
  changing how agents start them.
- The plugin gains host-side code: shelling out to `lsof`/`ps` and killing
  processes. It must never signal a process it did not list, and must
  re-check identity (PID with start time) before every signal.
- macOS and Linux only; where `lsof` is missing the page says so.
- Who started a process is not shown; its environment stands in for it.
- Which processes count as "running in a bb terminal" depends on matching
  process ancestry to a terminal's shell, which the SDK may not expose; see
  the spec's open questions.
- Specs: a new `services` spec; NAV-1 changes to two pages; AGENT rules for
  the new CLI command and the skill's check.
