# Does an environment-scoped list include thread terminals?

- Date: 2026-10-10
- bb: 0.46.0
- Plugin SDK: 0.6.37

## Question

Brief open question 1. If listing terminals with environment scope also returns
terminals started from a thread in that environment, one call fills the hub.
If not, the hub must also list the environment's threads.

## Procedure

In environment `env_643iz3ytpv`, with a throwaway thread `thr_ecmdxehm6v`:

```sh
bb terminal create --thread thr_ecmdxehm6v --command "sleep 999"
bb terminal create --environment env_643iz3ytpv --command "sleep 999"
bb terminal list --json --environment env_643iz3ytpv
bb terminal list --json --thread thr_ecmdxehm6v
```

## Result

- The environment list returned only the environment-scoped terminal.
- The thread list returned only the thread-scoped terminal.
- The thread terminal still records `environmentId: "env_643iz3ytpv"` and
  `threadId: "thr_ecmdxehm6v"`, so every session says where it belongs.

A terminal the user opened from a thread's right sidebar (`term_ng2kvsut29` in
`thr_f4wcn6b5su`) behaved the same: listed under `--thread`, absent from
`--environment`. Sidebar terminals also retitle themselves from the running
command and directory (`sleep 999 ~/R/a/bb-plugin-terminal-hub`).

## Consequences

- Answers the open question in ADR 202610100902: the hub lists the
  environment-scoped terminals plus, for each thread in the environment
  (`threads.list({ environmentId })`), that thread's terminals.
- Archived threads must be included in that walk; see
  [thread terminal lifecycle](2026-10-10-thread-terminal-lifecycle.md).
