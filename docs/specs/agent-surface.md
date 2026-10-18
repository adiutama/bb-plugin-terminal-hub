# Agent surface

- Status: implemented
- Prefix: AGENT
- Decisions: 202610100907, 202610100908, 202610180433, 202610180513

What the plugin gives agents, so the processes they start show up in the hub
and they stop starting duplicates.

## Behaviour

The plugin ships a skill and a CLI command. The skill tells agents when to use
environment scope and to check the CLI before starting something long-running:
`bb terminal-hub list` for terminals, `bb terminal-hub services` for servers
running outside them (the Services page's list). It also tells agents to label
the detached servers they start with the agent service record, so the Services
page and the CLI can name them and show them as one set.

## Rules

- **AGENT-1** The plugin ships a skill telling agents to start long-running processes (dev servers, watchers) at environment scope with `bb terminal create --environment <id>` and a descriptive `--title`. (ADR 202610100907)
- **AGENT-2** The skill tells agents to list what is already running before starting a long-running process, and to reuse a matching terminal instead of starting a duplicate. (ADR 202610100907)
- **AGENT-3** `bb terminal-hub list` prints the same terminals as the session list for one environment, grouped the same way, with each thread terminal's thread and state. (ADR 202610100908)
- **AGENT-4** `bb terminal-hub list` defaults to the calling thread's environment (`$BB_ENVIRONMENT_ID`) and accepts `--environment <id>` to choose another. Without either, it exits with an error that says to pass `--environment`. (ADR 202610100908)
- **AGENT-5** `bb terminal-hub list --json` prints machine-readable output with each terminal's id, title, status, scope, thread, and server hint. (ADR 202610100908)
- **AGENT-6** The skill tells agents to leave environment-scoped long-running processes running when their own work is done, unless the user asks them to stop; cleanup is the user's call through the hub. (ADR 202610100907)
- **AGENT-7** `bb terminal-hub services` prints the processes the Services page lists for one environment, chosen as AGENT-4 chooses it, each with its ports, PID, command line, service name and set title (SVC-25, SVC-26), starting thread, and log path. (ADR 202610180433, 202610180513)
- **AGENT-8** `bb terminal-hub services --json` prints them machine-readable: each process's pid, ports, command, startedAt, threadId, logPath, environmentId, `name`, and `set` (`record`, `id`, `title`). Neither form prints a record's URLs or credentials. (ADR 202610180433, 202610180513)
- **AGENT-9** The skill tells agents to run `bb terminal-hub services` as well as `bb terminal-hub list` before starting a server, and to reuse a listed server instead of starting a duplicate. (ADR 202610180433)
- **AGENT-10** The skill tells agents that start a detached server to label it with the agent service record contract: `AGENT_SERVICE_RECORD` and `AGENT_SERVICE_NAME` on the process and a version-1 `services.json`. (ADR 202610180513)
