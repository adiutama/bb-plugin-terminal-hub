---
name: terminal-hub
description: Start and reuse long-running processes (dev servers, watchers, log tails) so they show up in Terminal Hub. Use before starting any process that keeps running after the command returns, or when the user asks what is running in this checkout or worktree.
---

# Terminal Hub

Terminal Hub is a Terminals page listing every terminal in a checkout or
worktree (an environment). Environment-scoped terminals are the shared space it
manages: every thread in the environment sees them, and they outlive any one
thread. Its Services page lists the servers running in an environment outside
bb terminals, such as ones started detached with `nohup` or a database's own
daemon.

## Before starting a long-running process

1. See what is already running, in terminals and outside them:

   ```sh
   bb terminal-hub list              # this thread's environment's terminals
   bb terminal-hub list --json       # id, title, status, scope, thread, serverHint
   bb terminal-hub services          # servers listening here outside bb terminals
   bb terminal-hub services --json   # pid, ports, command, startedAt, threadId, logPath
   ```

2. If a terminal already runs the same thing (same command or title, or a
   `serverHint` on the port you need), reuse it: read it with
   `bb terminal output <id>`, send input with `bb terminal send <id> --text … --enter`,
   or `bb terminal restart <id>` for a fresh shell. Do not start a duplicate.

3. If `services` lists a server with the command or port you need, reuse it:
   it is already running, and its log is at `logPath`. Do not start a
   duplicate on another port.

## Starting one

Start dev servers, watchers, and other long-running processes at environment
scope, with a title that says what runs there:

```sh
bb terminal create --environment "$BB_ENVIRONMENT_ID" --title "web dev server :3000" --command "pnpm dev"
```

Not `--thread`: a thread terminal is hidden from the next thread and is
listed as stale once this thread settles. Short commands that finish on their
own (tests, builds, one-off scripts) do not need a terminal at all.

## When your work is done

Leave environment-scoped long-running processes running unless the user asks
you to stop them. Cleaning them up is the user's call, from the Terminals page.
