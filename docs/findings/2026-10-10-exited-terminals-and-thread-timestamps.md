# Are exited terminals listed, and which timestamp says when a thread settled?

- Date: 2026-10-10
- bb: 0.46.0
- Plugin SDK: 0.6.37

## Question

The session list wants to show exit codes (ADR 202610100904) and how long ago a
thread stopped being active (ADR 202610100902).

## Procedure

```sh
bb terminal create --environment env_643iz3ytpv --command "exit 3"
bb terminal list --json --environment env_643iz3ytpv   # after 3 s
bb terminal show <id> --json
bb thread show thr_f4wcn6b5su --json
```

## Result

- The exited terminal was **not** in `list`. `show` still returned it with
  `status: "exited"`, `exitCode: 3`, `closeReason: "process-exit"`.
- Thread `updatedAt` equalled `lastReadAt` + 1 ms: merely reading a thread bumps
  it. `latestAttentionAt` did not move on read. Archived threads have
  `archivedAt`.

## Consequences

- The hub can only show an exit code for a terminal it saw running: when a
  listed terminal disappears, `get` it and keep the row until dismissed.
- "Stopped being active" uses `archivedAt` for archived threads and
  `latestAttentionAt` otherwise, never `updatedAt`.
