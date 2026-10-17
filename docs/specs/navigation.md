# Navigation

- Status: implemented
- Prefix: NAV
- Decisions: 202610171617

How the Terminals page is reached, and how its URL keeps the user on the same
shell across reloads and back/forward.

## Behaviour

The page is a `navPanel` with its own rail entry, like the Files plugin. The
part of the URL after the page path (`subPath`) carries the selection.

```
/plugins/terminal-hub/terminals/<projectId>/<environmentId>/<terminalId>
```

## Rules

- **NAV-1** The plugin registers one `navPanel` titled "Terminals" at path `terminals`, so the page lives at `/plugins/terminal-hub/terminals`.
- **NAV-2** The URL carries the selected project, environment, and terminal; reloading the page restores all three. (ADR 202610171617)
- **NAV-3** Selecting a terminal or an environment adds a history entry, so back and forward move between previously selected shells and environments. (ADR 202610171617)
- **NAV-4** Opening the page without an environment in the URL selects, in order: the environment of the thread bb was showing (`useBbContext`), if the rail lists it; the environment the page last showed since bb loaded, if listed; else the first environment the rail lists (LIST-33). It then selects that environment's remembered tab (LIST-36). The choice replaces the history entry. Until the rail is listed, the page waits rather than choosing. (ADR 202610171617)
- **NAV-8** Selections the page makes on its own (NAV-4, LIST-37, ACT-7, NAV-5) replace the current history entry; only the user's own choice of an environment or a terminal adds one. (ADR 202610171617)
- **NAV-5** A link to a terminal that no longer exists opens its environment, if listed, else as NAV-4 says, with a notice that the terminal is gone. So does returning to the page when the selected terminal went away meanwhile (LIST-28). (ADR 202610171617)
- **NAV-9** The URL does not carry the rail's find text (LIST-42), and typing in it adds or replaces no history entry. (ADR 202610171617)
