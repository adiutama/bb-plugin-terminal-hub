# Services

- Status: draft
- Prefix: SVC
- Decisions: 202610180433, 202610180513

A view of the Terminals page listing the servers running in bb environments' folders that are not bb
terminals, mostly ones agents started detached, so the user can see them,
open them, read their logs, and stop them.

## Behaviour

A "Services" button in the Terminals page's title bar, beside its close button, switches the main view, right of the rail, to a table instead of the terminal tabs. Services are rows to scan: which ports are taken, what each one runs, and which thread started it. The log and the actions that matter are one click away, in a drawer.

```
┌ Services (main view) ──────────────────────────────────────── [⌕ Find          ] ┐
│  Port      Program     Started by                                    Up          │
│  [K] kai-platform  ⑂ bb/map-all-page-urls-for-the-app-thr_6z6iitf6ba ──────────  │
│▌ :55401 ↗  node        ◌ Map all page URLs for the app               5h    ⋯     │
│  :55400    postgres    ◌ Map all page URLs for the app               5h    ⋯     │
│  [K] kai-platform  ⑂ bb/engineering-payments-cross-spc-batches-… ──────────────  │
│  :3164     node        ◌ Worker: payments slice D (settlement batches) 2d  ⋯     │
│  [T] terminal-hub  ⑂ remote-box ─────────────────────────────────────────────── │
│            Not checked: this environment is on another machine.                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│  :55401  node   PID 48345   Up 5h   ▤ app-kai.log         [↗ Open] [Stop]   ✕    │
│ ╭──────────────────────────────────────────────────────────────────────────────╮ │
│ │ [t] GET /entities/:id/cost-sheet/items/:itemId 200 316.1ms db=311.6ms …      │ │
│ │ [t] GET /settings/drive 200 9254.2ms db=38.2ms tx=21 q=108                   │ │
│ ╰──────────────────────────────────────────────────────────────────────────────╯ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- The port is the row's anchor and a link (↗ on hover and on the selected
  row).
- The program is underlined with dots, and hovering it shows the full command
  line.
- The thread is a link to the thread.
- `⋯` holds Copy PID, Copy command line, Copy port and Stop….
- The marked row is selected, and its log is in the drawer.

## Rules

- **SVC-1** The plugin registers no page for services. A "Services" button on the right of the Terminals page's title bar, beside bb's close button (the `navPanel`'s `headerContent`), shows the number of listed services when it is above zero and is shown pressed while the Services view is shown. Pressing it switches the main view, right of the rail, to the Services view; pressing it again, or selecting an environment or a terminal in the rail, switches back to the terminals. The rail is unchanged. (ADR 202610180433)
- **SVC-2** A process on the machine running bb is listed when it listens on a TCP port and belongs to an environment: the one its `BB_ENVIRONMENT_ID` environment variable names, when bb knows it; else the one whose `path` is its working folder or contains it. When its environment variables cannot be read, only the folder applies. (ADR 202610180433)
- **SVC-3** A process that has a controlling terminal, or whose environment has `BB_TERMINAL_SESSION_ID`, is not listed. (ADR 202610180433)
- **SVC-18** A process whose `BB_THREAD_ID` names a thread bb knows shows that thread's title in the "Started by" column, as a link. Clicking it opens the thread in bb and does not select the row. Otherwise the cell is empty. (ADR 202610180433)
- **SVC-4** The Services view holds one full-width table with the columns Port, Program, Started by and Up, headed in sentence case, and a `⋯` menu per row. Each process is one row: its listening ports in ascending order (SVC-6), its program (SVC-24), its starting thread (SVC-18), and the time since it started, right-aligned. The PID is not a column. (ADR 202610180433)
- **SVC-24** A row's program is the file name of its command line's first word: `node` for `/Users/me/.local/share/mise/installs/node/22.23.2/bin/node --require … apps/api/src/main.ts`. Hovering it shows the full command line, wrapped. (ADR 202610180433)
- **SVC-14** Rows are grouped under a header row per environment: a chip with the project's initial, the project's name, then a branch icon and the environment's name, named as LIST-34 names it. Groups are ordered as LIST-33 orders projects and environments. An environment with no listed process has no header row (except SVC-11). (ADR 202610180433)
- **SVC-15** The Services view's header shows the title "Services" and a find field. The find field narrows the rows to those where every whitespace-separated word appears, ignoring case, in a port, the command line, the PID, the service's name (SVC-26), its set's title or case (SVC-25), the environment's name, or the project's name. Groups left with no row are hidden. With no match, the table says "No service matches “…”." (ADR 202610180433, 202610180513)
- **SVC-5** Selecting a row opens a drawer along the bottom of the Services view, below the table. Its header shows the process's ports, its program (with the full command line on hover, as SVC-24), its PID, the time since it started, and its log file's name (the full path on hover, with a copy action). It also has Open, Stop and × buttons. Below the header, the file's last 64 KB is shown read-only, scrolled to the end and refreshed while shown. One drawer is open at a time: selecting another row switches it, and × closes it. When standard output is not a regular file, the drawer says the process has no log file. (ADR 202610180433)
- **SVC-16** When the selected process is no longer listed, its drawer says it ended and keeps the last log shown until closed. (ADR 202610180433)
- **SVC-17** With no listed process, the Services view says "No servers running in your environments." and explains that it lists processes listening on a port inside an environment's folder. (ADR 202610180433)
- **SVC-6** Each port in a row is a link that opens `http://127.0.0.1:<port>` in a new browser tab. The drawer's "Open" does the same; for a process with several ports, it offers a menu with one item per port. (ADR 202610180433)
- **SVC-7** A row's `⋯` menu copies the PID, the command line, or a port (one item per port), and offers Stop…. (ADR 202610180433)
- **SVC-8** "Stop", from the row's `⋯` menu or the drawer, asks for confirmation. It then re-checks that the PID has the start time that was listed. If it does, it sends SIGTERM; if not, it reports that the process changed and refreshes. (ADR 202610180433)
- **SVC-19** Stop and Force stop signal the listener's whole process group when the group's leader is gone, is listed, or belongs to the same environment by SVC-2, and every process in the group had its environment read, has no controlling terminal and no `BB_TERMINAL_SESSION_ID`, and is not protected (SVC-22); otherwise only the listener. The confirmation says how many processes will be signalled. (ADR 202610180433)
- **SVC-9** After Stop, the row's Up cell says "Stopping…". If the process is still alive 5 seconds after SIGTERM, its row shows a "Force stop" button beside its `⋯`, and the drawer's Stop becomes "Force stop". Force stop sends SIGKILL after the same identity check. (ADR 202610180433)
- **SVC-10** While the Services view is shown the list refreshes every 5 seconds. Otherwise, while the Terminals page is visible, the button's count refreshes every 30 seconds. Nothing refreshes while the page is hidden. (ADR 202610180433)
- **SVC-11** Environments on another host are shown as "not checked". (ADR 202610180433)
- **SVC-12** When `lsof` is not available, the Services view says detection is unavailable on this machine instead of an empty list. (ADR 202610180433)
- **SVC-13** The server signals only PIDs it listed in its latest scan. (ADR 202610180433)
- **SVC-20** A process listening only on Unix sockets, with no TCP port, is not listed. (ADR 202610180433)
- **SVC-21** The URL carries neither the Services view nor a selected row: reloading shows the terminals, the view opens with no row selected and the drawer closed, and switching views or selecting a row adds no history entry. (ADR 202610180433)
- **SVC-22** bb's own processes are never listed and never signalled: the plugin server's process, its ancestors, every process in their process groups, and any process running bb's executable. (ADR 202610180433)
- **SVC-23** Switching to the Services view and back keeps the terminals' state: the selected environment and terminal, and each terminal's session, are as they were. (ADR 202610180433)
- **SVC-25** Rows whose processes have the same `AGENT_SERVICE_RECORD` environment variable form a set: within their environment group they are shown together under a set row, ordered by port. The set row shows the record's `title` when the record is readable (SVC-27), with its `case` on hover; otherwise the name of the folder holding the record. Unlabelled rows follow the sets, as today. (ADR 202610180513)
- **SVC-26** A row whose process has `AGENT_SERVICE_NAME` shows that name in the Program column, with the program (SVC-24) after it in muted text (`api  node`); hovering still shows the full command line. (ADR 202610180513)
- **SVC-27** The record is read only when `AGENT_SERVICE_RECORD` is an absolute path to a regular file, not a symlink, owned by the current user, of at most 64 KiB, holding a JSON object with `version` 1 and a `services` array. Otherwise it is unreadable and only SVC-25's grouping and SVC-26's name apply. Fields of the wrong type, entries missing a required field, and unknown fields are ignored one by one. (ADR 202610180513)
- **SVC-28** When the record is readable and has an entry whose `name` matches the row's, the drawer shows a Connect section: that entry's URLs, each with its label, and the set's credentials, each with its label and username. Copy actions give each full value. (ADR 202610180513)
- **SVC-29** Credential secrets and the password in a URL's user info are shown as `••••` until the user presses Show, in the drawer only; copying gives the full value. A URL is a link, opening in a new browser tab, only when its scheme is `http` or `https` and its host is `127.0.0.1`, `localhost` or `::1`; other URLs are copy-only. Record strings are shown as plain text. (ADR 202610180513)
- **SVC-30** Nothing read from a record changes which processes are listed, which log is shown, or what Stop signals. (ADR 202610180513)

