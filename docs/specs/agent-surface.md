# Agent surface

- Status: agreed
- Prefix: AGENT
- Decisions: 202610100907, 202610100908

What the plugin gives agents, so the processes they start show up in the hub
and they stop starting duplicates.

## Behaviour

The plugin ships a skill and a CLI command. The skill tells agents when to use
environment scope and to check the CLI before starting something long-running.

## Rules

- **AGENT-1** The plugin ships a skill telling agents to start long-running processes (dev servers, watchers) at environment scope with `bb terminal create --environment <id>` and a descriptive `--title`. (ADR 202610100907)
- **AGENT-2** The skill tells agents to list what is already running before starting a long-running process, and to reuse a matching terminal instead of starting a duplicate. (ADR 202610100907)
- **AGENT-3** `bb terminal-hub list` prints the same terminals as the session list for one environment, grouped the same way, with each thread terminal's thread and state. (ADR 202610100908)
- **AGENT-4** `bb terminal-hub list` defaults to the calling thread's environment (`$BB_ENVIRONMENT_ID`) and accepts `--environment <id>` to choose another. Without either, it exits with an error that says to pass `--environment`. (ADR 202610100908)
- **AGENT-5** `bb terminal-hub list --json` prints machine-readable output with each terminal's id, title, status, scope, thread, and server hint. (ADR 202610100908)
- **AGENT-6** The skill tells agents to leave environment-scoped long-running processes running when their own work is done, unless the user asks them to stop; cleanup is the user's call through the hub. (ADR 202610100907)

