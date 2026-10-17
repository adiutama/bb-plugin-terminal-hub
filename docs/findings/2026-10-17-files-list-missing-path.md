# What does `files.list` say about a folder that does not exist?

- Date: 2026-10-17
- bb: 0.46.1
- Plugin SDK: 0.6.37

## Question

LIST-48 (ADR 202610171604) leaves environments whose folder no longer exists
out of the "New terminal in…" menus, and asks the host with `files.list`
(`hostId`, `path`). Which error does it give for a missing path, so a missing
folder can be told apart from a check that failed for another reason?

## Procedure

A temporary, uncommitted build of the page put `useSdk()` on `window`; a
headless browser (`bb browser-automation open --backend local --headless`)
opened `/plugins/terminal-hub/terminals` and called the SDK from the page.
Paths on host `host_rdhfin455m`:

- three `feature/review` environments of project `proj_vptixvbm9s`
  (`/var/folders/kq/…/T/review-pr-{CuiApF,Pn4Tl8,BYxDhc}/repo`), which
  `ls` confirms do not exist, nor do their parents;
- an existing empty folder (`/tmp/th-empty-probe`), `/definitely/not/here`,
  a file (`/etc/hosts`), an unreadable folder (`/private/var/root`), and an
  unknown host.

Each was passed to `files.list({ hostId, path, limit: 1 })`, and the missing
and empty folders also to `files.read`, `files.listPaths` and
`hosts.directory({ hostId, path })`.

## Result

`files.list` does not fail for a missing path. It answers exactly as for an
existing empty folder:

```
files.list missing path      → { files: [], truncated: false }
files.list /definitely/not/here → { files: [], truncated: false }
files.list empty folder      → { files: [], truncated: false }
files.listPaths missing path → { paths: [], truncated: false }
```

Other failures are errors (`BbHttpError` with `status`, `code`, `body`):

```
unknown host       → 404 host_not_found  "Host not found"
a file, not folder → 400 invalid_path    "Path \"/etc/hosts\" is not a directory"
unreadable folder  → 502 EACCES          "EACCES: permission denied, scandir …"
```

Two other calls do tell a missing folder apart:

```
hosts.directory missing path → 502 ENOENT "ENOENT: no such file or directory, stat '…'"
hosts.directory empty folder → { directory: "/private/tmp/th-empty-probe", parent: "/private/tmp", entries: [] }
files.read missing path      → 404 ENOENT "Path does not exist: …"
files.read empty folder      → 400 invalid_path "Path is a directory, not a file"
```

## Consequences

`files.list`, as LIST-48 names it, cannot tell a missing folder from an empty
one, so it cannot implement the rule. `hosts.directory({ hostId, path })` can:
success means the folder exists, code `ENOENT` means it does not, and any
other error is a failed check. Using it needs LIST-48 changed; until then the
rule is not implemented.
