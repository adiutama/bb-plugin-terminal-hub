# Services

- Status: implemented
- Prefix: SVC
- Decisions: 202610171802

A page listing the servers running in bb environments' folders that are not bb
terminals, mostly ones agents started detached, so the user can see them,
open them, read their logs, and stop them.

## Behaviour

The page is a table, not the Terminals page's rail and tabs: services are rows
to scan (which ports are taken, what is still up), with the log one click
away in a drawer.

```
┌ Services ─────────────────────────────────── [Find…          ]  3 running ┐
│ PORT     PROCESS                    STARTED BY        PID     UP           │
│ kai-platform › thr_6z6iitf6ba-1                                            │
│ :55401   node apps/api/src/main.ts  Map all page URLs 48345   2h  ↗ ⧉ ■    │
│▌:55400   postgres -D …/pg           Map all page URLs 33438   2h    ⧉ ■    │
│ terminal-hub › main                                                        │
│ :5173    vite                                         51002   9m  ↗ ⧉ ■    │
│ kai-platform › remote-box   not checked (other host)                       │
├────────────────────────────────────────────────────────────────────────────┤
│ postgres -D …/pg · ~/.agents/…/pg.log                          ⧉ path   ✕  │
│ 2026-10-17 20:16:31 LOG  database system is ready to accept connections    │
│ …                                                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

↗ opens the URL, ⧉ copies, ■ stops; the marked row is selected and its log
is in the drawer.

## Rules

- **SVC-1** The plugin registers a `navPanel` titled "Services" at path `services`. (ADR 202610171802)
- **SVC-2** A process on the machine running bb is listed when it listens on a TCP port and belongs to an environment: the one its `BB_ENVIRONMENT_ID` environment variable names, when bb knows it; else the one whose `path` is its working folder or contains it. When its environment variables cannot be read, only the folder applies. (ADR 202610171802)
- **SVC-3** A process that has a controlling terminal, or whose environment has `BB_TERMINAL_SESSION_ID`, is not listed. (ADR 202610171802)
- **SVC-18** A process whose `BB_THREAD_ID` names a thread bb knows shows that thread's title, linked to the thread, in a "Started by" column; otherwise the cell is empty. (ADR 202610171802)
- **SVC-4** The page is one full-width table with columns port, process, started by, PID, up, and actions. Each process is one row: its listening ports in ascending order, its command line (truncated at the end, in full on hover), its PID, and the time since it started. (ADR 202610171802)
- **SVC-14** Rows are grouped under a header row per environment, `project › environment`, with the environment named as LIST-34 names it; groups are ordered as LIST-33 orders projects and environments, and an environment with no listed process has no header row (except SVC-11). (ADR 202610171802)
- **SVC-15** The page header shows the title "Services", a find field, and the number of listed processes ("3 running"). The find field narrows the rows to those where every whitespace-separated word appears, ignoring case, in a port, the command line, the PID, the environment's name, or the project's name; groups left with no row are hidden; with no match the table says "No service matches “…”." (ADR 202610171802)
- **SVC-5** Selecting a row opens a drawer along the bottom of the page, below the table, showing the process's command line, the path of its log file with a copy action, and the file's last 64 KB read-only, scrolled to the end and refreshed while shown. One drawer is open at a time; selecting another row switches it, × closes it. When standard output is not a regular file, the drawer says the process has no log file. (ADR 202610171802)
- **SVC-16** When the selected process is no longer listed, its drawer says it ended and keeps the last log shown until closed. (ADR 202610171802)
- **SVC-17** With no listed process, the page says "No servers running in your environments." and explains that it lists processes listening on a port inside an environment's folder. (ADR 202610171802)
- **SVC-6** "Open" opens `http://127.0.0.1:<port>` for the chosen port in a new browser tab. (ADR 202610171802)
- **SVC-7** "Copy" copies the PID, the command line, or a port. (ADR 202610171802)
- **SVC-8** "Stop" asks for confirmation, then re-checks that the PID has the start time listed; if it does, sends SIGTERM, else reports that the process changed and refreshes. (ADR 202610171802)
- **SVC-19** Stop and Force stop signal the listener's whole process group when the group's leader is gone, is listed, or belongs to the same environment by SVC-2, and every process in the group had its environment read, has no controlling terminal and no `BB_TERMINAL_SESSION_ID`, and is not protected (SVC-22); otherwise only the listener. The confirmation says how many processes will be signalled. (ADR 202610171802)
- **SVC-9** If a stopped process is still alive 5 seconds after SIGTERM, its row offers "Force stop", which sends SIGKILL after the same identity check. (ADR 202610171802)
- **SVC-10** The list refreshes every 5 seconds while the page is visible and not while it is hidden. (ADR 202610171802)
- **SVC-11** Environments on another host are shown as "not checked". (ADR 202610171802)
- **SVC-12** When `lsof` is not available, the page says detection is unavailable on this machine instead of an empty list. (ADR 202610171802)
- **SVC-13** The server signals only PIDs it listed in its latest scan. (ADR 202610171802)
- **SVC-20** A process listening only on Unix sockets, with no TCP port, is not listed. (ADR 202610171802)
- **SVC-21** The URL carries no selected row: the page opens with no row selected and the drawer closed, and selecting a row adds no history entry. (ADR 202610171802)
- **SVC-22** bb's own processes are never listed and never signalled: the plugin server's process, its ancestors, every process in their process groups, and any process running bb's executable. (ADR 202610171802)
