# Can a thread's terminal be read, written, and closed from outside the thread?

- Date: 2026-10-10
- bb: 0.46.0
- Plugin SDK: 0.6.37

## Question

Brief open question 3. The hub controls terminals it did not create.

## Procedure

On thread-scoped terminals of throwaway thread `thr_ecmdxehm6v`:

```sh
bb terminal create --thread thr_ecmdxehm6v --command cat
bb terminal send <id> --text $'hello from cli\n'
bb terminal output <id>
bb terminal close <id> --if-clean
bb terminal close <id>
```

`--if-clean` was also tried on a fresh terminal with no input, and on one after
a single `send`.

## Result

- Output contained `hello from cli` echoed back: reading and writing work.
- `close` (force) closed it: `status: "exited"`, `closeReason: "user"`.
- `close --if-clean` closes only when no input was ever sent. Input from
  `send` counts: it sets `lastUserInputAt`. When the terminal is not clean,
  the call returns the session still `running` and **no error**.

On a terminal the user opened in a thread's right sidebar and running
`sleep 999`, `bb terminal send --text "hello from terminal hub"` appeared in the
sidebar view (confirmed by the user with a screenshot) and in `output`.

BB sets `lastUserInputAt` when a sidebar terminal opens (about 130 ms after
`createdAt`), so `if-clean` never closes a sidebar terminal.

## Consequences

- The hub can fully control thread terminals through the SDK.
- After a `close` with `mode: "if-clean"`, check the returned `status`; a
  no-op is silent. In practice the hub should force-close after its own
  confirmation.
