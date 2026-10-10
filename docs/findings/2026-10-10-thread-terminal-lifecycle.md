# What happens to a thread's terminals when it settles, is archived, or is deleted?

- Date: 2026-10-10
- bb: 0.46.0
- Plugin SDK: 0.6.37

## Question

Brief open question 2. Decides which threads the hub must walk and what "stale"
means.

## Procedure

Throwaway thread `thr_ecmdxehm6v` with a thread terminal running `sleep 999`:

1. Let the thread settle (`bb thread wait`, status `idle`).
2. `bb thread archive`, then `bb terminal show` immediately and after 15 s.
3. Create another terminal on the archived thread.
4. `bb thread delete --yes`, then `bb terminal show` after 5 s.

## Result

| Thread state | Its terminals |
| --- | --- |
| Settled (`idle`) | Keep running. |
| Archived | Keep running (still `running`, `closeReason: null` after 15 s). New terminals can still be created on the archived thread. |
| Deleted | Closed: `status: "exited"`, `closeReason: "thread-archived"` (not `"thread-deleted"`, although that value exists). |

## Consequences

- "From threads" must include **archived** threads in the environment, not just
  active ones, or their running terminals become invisible
  (`threads.list({ environmentId, archived: true })`).
- Stale highlighting (ADR 202610100902) and bulk cleanup (ADR 202610100903) apply
  to archived threads' terminals too.
- Do not rely on `closeReason` to tell deletion from archival.
