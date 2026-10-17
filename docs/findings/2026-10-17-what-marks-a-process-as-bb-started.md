# What marks a process as started from a bb terminal, or by a thread's agent?

- Date: 2026-10-17
- bb: 0.46.1
- Plugin SDK: 0.6.37

## Question

The Services page (ADR 202610171641) must leave out processes running in a bb
terminal (SVC-3), and its open questions ask how Stop should treat a
listener's launcher. The SDK exposes no terminal PID or TTY. What on a
process tells these apart, and does the working-folder rule catch what
agents start?

## Procedure

1. `bb terminal create --environment "$BB_ENVIRONMENT_ID" --title "svc-probe :58123" --json --command "python3 -m http.server 58123 --bind 127.0.0.1"`,
   then for the listener (`lsof -tiTCP:58123 -sTCP:LISTEN`) walk
   `ps -o pid=,ppid=,pgid=,tty=,comm=` up to pid 1 and list its `BB_*`
   environment variables with `ps eww -o command= -p <pid>`. Closed the
   terminal afterwards.
2. The same for the detached servers of @thread:thr_6z6iitf6ba: the API
   listener (48345), its launcher `npm run dev` (48265), and Postgres (33438).
3. `lsof -a -p <pid> -d cwd -Fn` and `-d 1,2` for working folder and output.
4. `ps -A -o pid=,pgid=,comm=` for the listener's process group.

## Result

- **Terminal process:** has `BB_TERMINAL_SESSION_ID=term_k8t5amni8n`, a TTY
  (`ttys001`), and its ancestors are the shell and then bb's host daemon.
  It has no `BB_THREAD_ID`.
- **Agent-started processes:** the API listener and Postgres both carry
  `BB_THREAD_ID=thr_6z6iitf6ba`, `BB_ENVIRONMENT_ID=env_d8u48j8nnz`, and
  `BB_PROJECT_ID`, inherited from the agent's shell through `nohup setsid`
  and `pg_ctl`. No TTY, no `BB_TERMINAL_SESSION_ID`. (`npm run dev` showed no
  `BB_*` variables in `ps eww`; its listener child did.)
- **Working folder:** the API listener's is the worktree, but Postgres's is
  its data folder `~/.agents/throwaway-services/…/pg`, outside every
  environment. The working-folder rule (SVC-2) misses it; `BB_ENVIRONMENT_ID`
  finds it.
- **Output:** both write standard output to a regular file (`app-kai.log`,
  `pg.log`), so the log drawer can show them.
- **Process group:** `setsid` gave the launch its own group (48263, leader
  gone). It holds exactly `npm run dev`, `npm exec tsx watch`, two `node`
  processes and `esbuild`. Signalling the group stops the launcher with the
  listener, so `tsx watch` cannot restart it. Postgres leads its own group.
- Reading another process's environment works for the user's own processes
  (`ps eww` on macOS; `/proc/<pid>/environ` on Linux). Not checked for
  processes of other users or with a hardened runtime.
- Added after review: macOS hides the environment of Apple-signed programs.
  `FOO_PROBE=1 /bin/sleep 30` shows no `FOO_PROBE` in `ps eww`;
  `FOO_PROBE=1 node -e …` (mise) does. So `BB_TERMINAL_SESSION_ID` cannot be
  relied on for `/bin/zsh`, `/usr/bin/python3` and the like; ADR
  202610171802 adds the controlling terminal as a second sign.

## Consequences

ADR 202610171646 supersedes ADR 202610171641: find processes by
`BB_ENVIRONMENT_ID` as well as by folder, leave out those with
`BB_TERMINAL_SESSION_ID`, show the starting thread from `BB_THREAD_ID`, and
let Stop signal the process group when the group is the launch's own.
