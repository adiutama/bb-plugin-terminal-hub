# Does restarting a terminal keep its id?

- Date: 2026-10-11
- bb: 0.46.0
- Plugin SDK: 0.6.37

## Question

ACT-3's Restart shell uses bb's `restart`. If the id stays the same, the
hub's open view would keep reading the old output stream; if it changes, the
row and the selection must move to the new id.

## Procedure

```sh
bb terminal create --environment <env> --title restart-probe --command "echo hi; sleep 60" --json
bb terminal restart <id> --json
bb terminal output <id> --json
bb terminal list --environment <env> --json
```

## Result

- `restart` returned a session with a **new** id, `running`, same title and
  scope.
- The old id now reads `status: "exited"`, `exitCode: 0`, `closeReason: "user"`,
  and is gone from `list`.
- A new terminal's output starts at `seq: 0`, with `nextSeq: 1` after one
  chunk.

## Consequences

- The page replaces the old row with the returned session and selects the new
  id (`HubStore.replace`), which remounts the view on the new stream.
- The old terminal must not be kept as an exited row (LIST-11): the hub closed
  it, so it is dropped like any terminal closed from the hub.
