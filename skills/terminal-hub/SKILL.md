---
name: terminal-hub
description: Start and reuse long-running processes (dev servers, watchers, log tails) so they show up in Terminal Hub. Use before starting any process that keeps running after the command returns, or when the user asks what is running in this checkout or worktree.
---

# Terminal Hub

Terminal Hub is a Terminals page listing every terminal in a checkout or
worktree (an environment). Environment-scoped terminals are the shared space it
manages: every thread in the environment sees them, and they outlive any one
thread.

## Before starting a long-running process

1. See what is already running:

   ```sh
   bb terminal-hub list            # this thread's environment
   bb terminal-hub list --json     # id, title, status, scope, thread, serverHint
   ```

2. If a terminal already runs the same thing (same command or title, or a
   `serverHint` on the port you need), reuse it: read it with
   `bb terminal output <id>`, send input with `bb terminal send <id> --text … --enter`,
   or `bb terminal restart <id>` for a fresh shell. Do not start a duplicate.

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
