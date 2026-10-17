# Session list

- Status: agreed
- Prefix: LIST
- Decisions: 202610100901, 202610100911, 202610171354

The left rail and the tab strip of the Terminals page: every environment, in
every project, where something runs, and the terminals of the one selected,
so the user picks a place and then a shell.

## Behaviour

```
┌ Find environment      / ┐┌ api :8080 │ build exit 1 │ pnpm test --watch │ + ┐
│ ⌄ kai-platform          ││ api                         localhost:8080 ↗ ⟳ ⋯│
│   ⑂ main             2  ││ kai-platform/billing-v2 from Ship billing v2    │
│   ⑂ billing-v2       3  ││─────────────────────────────────────────────────│
│   ⑂ map-page-urls    1  ││ $ pnpm dev                                      │
│ ⌄ bb-plugin-terminal-hub││                                                 │
│   ⑂ main             2  ││          (the selected terminal, live)          │
└─────────────────────────┘└─────────────────────────────────────────────────┘
```

The rail lists projects in bb's order, each with its environments that have
terminals. Nothing in the rail or the tabs asks for attention: no status
dots, no ages, no stale marks. An ended terminal's tab is dimmed and shows
its exit code, so a crashed server never looks like a running one.

Environment names show as bb shows them (`bb/map-all-page-urls-for-the-app`,
`proto/visual-direction`), truncated when long.

Hovering a project header shows a `+`. Its "New terminal in…" menu lists
every environment of the project, empty ones included, and is how a first
shell is started where nothing runs yet.

Typing in "Find environment" narrows the rail: `5173` finds the environment
running vite on that port; `kai flaky` finds the `kai-platform` environment
whose thread is about flaky tests.

The list is built from two kinds of SDK calls, because an environment-scoped
list does not include thread terminals
([finding](../findings/2026-10-10-environment-list-excludes-thread-terminals.md)):
`terminals.list` for the environment, and `terminals.list` for each thread in
the environment, archived ones included
([finding](../findings/2026-10-10-thread-terminal-lifecycle.md)).

## Rules

- **LIST-1** An environment's terminals are its environment-scoped terminals plus the terminals of every thread in that environment, including archived threads. (ADR 202610171354)
- **LIST-7** When recent output contains a local server address (`http://localhost:<port>`, `http://127.0.0.1:<port>`, or a `Local:` line), the terminal has a server hint. The hint is read from the last 4 KB of output when the terminal is first listed, and updated while the terminal is viewed; hidden terminals are not re-read. (ADR 202610171354)
- **LIST-8** While the page is shown, the selected environment's own terminals are listed every 5 seconds and every other listed environment's every 30 seconds; a thread's terminals are listed again when bb signals that they changed (LIST-30); and every project is listed in full (its environments, all its threads, and their terminals) when the page opens or is returned to, when bb's realtime connection comes back, and every 2 minutes. Terminals created or closed elsewhere appear without a reload. (ADR 202610171354)
- **LIST-11** When a listed terminal disappears from the SDK list because it exited, or the terminal view sees it exit (VIEW-7), its tab stays, showing the exit code, until the user dismisses it, unless the user ended it from the view (LIST-32). Leaving the page and returning keeps the tab; a reload drops it. A terminal the user dismissed or closed never comes back. (ADR 202610171354)
- **LIST-12** Tabs are in this order: the environment's environment-scoped terminals, then its thread terminals, each group oldest first by creation time. (ADR 202610171354)
- **LIST-14** The environments are listed again when bb signals that one was created or deleted. (ADR 202610171354)
- **LIST-17** During the first full listing of the projects since bb loaded, the rail shows its progress instead of claiming nothing runs. The page says "Nothing running" only once every project's listing has succeeded since the page was opened or returned to (LIST-27). If a project fails to list, the rail shows the error under that project, keeps what it has, and the next listing tries again. (ADR 202610171354)
- **LIST-25** With no environment listed, the main pane says "Nothing running. Start a shell from a project's +." once the listing is complete (LIST-17); "Looking for terminals…" before then; and "Could not list every terminal yet; trying again shortly." after a failed listing. A linked terminal that cannot be reached (NAV-5) shows its error and Retry instead. (ADR 202610171354)
- **LIST-27** The lists last for the app session: returning to the page shows the rail and tabs it last had at once, and a reload starts over. What was kept from before a return is last known until every project's listing has succeeded again. While last known, the title bar says so (NAV-6), and nothing claims that a terminal or environment is missing: no "Nothing running", and no environment leaves the rail and no tab closes for being absent. While bb's realtime connection is down, everything is last known; when it comes back, it is confirmed again as on a return (LIST-28). (ADR 202610171354)
- **LIST-28** On return, when the selected terminal is listed, it is checked before anything else. Running: its tab is updated. Exited: its tab stays as an ended tab (LIST-11). Gone from bb: the page shows NAV-5's notice and selects as after a close (ACT-7). Not reachable: its tab and view stay, and the view shows the problem. A selected terminal that is not listed is handled as a link (NAV-5). Then the selected environment is listed, then the threads that changed while the page was away (LIST-31), then every project in full. (ADR 202610171354)
- **LIST-29** The rail's scroll position is kept until bb reloads. Returning to the page puts the environment that was at the top of the rail back where it was; if it is gone, the rail starts at the top. (ADR 202610171354)
- **LIST-30** Of bb's thread signals, `terminals-changed` lists that thread's terminals again; `thread-created`, `archived-changed`, `status-changed`, `title-changed` and `environment-changed` fetch the thread again, so its title, state, and environment are current (a `status-changed` whose `statusChange` gives the new status updates the thread without a fetch); a thread moved into or out of an environment moves its terminals with it; `thread-deleted` treats the thread's terminals as gone (LIST-11) without asking bb for the thread. Other changes, `events-appended` among them, are ignored. Each kind of request runs one at a time: a thread's fetch per thread, an environment's own terminals and its full listing per environment, a project's environment list, and a project's full listing; a signal that arrives during one runs it once more when it ends. (ADR 202610171354)
- **LIST-31** While the page is not shown, the lists keep receiving bb's signals but fetch nothing: they note which threads changed, whether the environments changed, and whether the realtime connection came back, and fetch them on return (LIST-28). (ADR 202610171354)
- **LIST-32** When the terminal shown in the view ends within 5 seconds of the user typing into that view (for example `exit`, Ctrl-D, or Ctrl-C on its process), whatever its exit code, its tab is removed as if dismissed, and the selection moves as after a close (ACT-7). A terminal that ends any other way, on its own, from elsewhere, or without recent typing in the view, keeps its ended tab (LIST-11). (ADR 202610171354)
- **LIST-33** The rail lists bb's projects in bb's order, each as a header with the project's name, and under it the project's environments in bb's order. An environment is listed only when it has terminals, running or ended and not dismissed (LIST-11), or holds the selected terminal; a project is listed only when it lists an environment. (ADR 202610171354)
- **LIST-34** An environment shows its name: bb's environment name, else its branch, else the last part of its path, as bb gives it, truncated at the end when it does not fit, with the full name on hover. Next to the name is the number of its running terminals, left out when zero. (ADR 202610171354)
- **LIST-35** Clicking a project header folds or unfolds its environments; it never changes the selection. A folded project still shows its header. Folded projects are remembered until bb reloads. A folded project that holds the selected environment shows that environment. (ADR 202610171354)
- **LIST-36** Clicking an environment selects it: its terminals become the tabs, and the tab it last showed since bb loaded is selected, else its first tab. The selected environment is marked in the rail. (ADR 202610171354)
- **LIST-37** An environment is always selected while one is listed. When the selected environment leaves the rail, because its last terminal closed or was dismissed, the next environment listed below it is selected, else the one above, else none. (ADR 202610171354)
- **LIST-38** Each tab shows the terminal's title, or "Terminal" when it has none. A running terminal with a server hint (LIST-7) also shows the hint's label (`:3000`). An ended terminal's tab is dimmed and shows "exit" and its exit code instead. Tabs show no status dot, age, folder, thread, or stale mark. (ADR 202610171354)
- **LIST-39** Clicking a tab selects its terminal. The tabs form a tablist: with focus on a tab, ← and → move to the previous and next tab and select it, and Home and End to the first and last. When the tabs do not fit, the strip scrolls sideways and keeps the selected tab in view. (ADR 202610171354)
- **LIST-40** A `+` after the last tab creates an interactive shell at environment scope in the selected environment, adds it as the last tab of its group (LIST-12), and selects it. (ADR 202610171354)
- **LIST-41** Each project header shows a `+` on hover and on focus within the header, and always with a coarse pointer. It opens "New terminal in…", a menu of every environment of the project in bb's order, those with no terminals included. Choosing one creates a shell there as LIST-40 does and selects that environment and the new terminal. (ADR 202610171354)
- **LIST-42** A "Find environment" field sits at the top of the rail. Empty or whitespace-only text is no filter. Otherwise the rail shows only the environments where every whitespace-separated word of the text appears, ignoring case, in the environment's name (as shown or in full), its project's name, or one of its terminals' title, server hint label, or owning thread's title; projects with no shown environment are left out, and folded projects unfold while the text is not empty. The selected environment stays selected and its tabs stay shown even when the rail hides it. (ADR 202610171354)
- **LIST-43** When no environment matches the find text, the rail says "No environment matches “…”." The find text is not in the URL, adds no history entry, is kept when leaving the page and returning, and starts empty after a reload. (ADR 202610171354)
- **LIST-44** Pressing `/` focuses the find field and selects its text when focus is inside the Terminals page but not in a text field, a terminal view, a menu, or a dialog, no Ctrl, Cmd, or Alt is held, and no input method is composing. In the field, Escape clears the text; with the text already empty, it moves focus to the selected environment in the rail. ↓ moves focus to the first environment shown, and Enter selects it. The page binds no Cmd/Ctrl+K: that is bb's thread switcher. (ADR 202610171354)
- **LIST-45** In the rail, with focus on an environment, ↓ and ↑ move focus to the next and previous environment shown without wrapping, ↑ from the first returns focus to the find field, and Enter or Space selects it. Moving focus does not change the selection. (ADR 202610171354)

## Open questions

None.
