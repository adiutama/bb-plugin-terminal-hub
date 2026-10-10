# Navigation

- Status: agreed
- Prefix: NAV
- Decisions: 202610101629, 202610101721

How the Terminals page is reached, and how its URL keeps the user on the same
shell across reloads and back/forward.

## Behaviour

The page is a `navPanel` with its own rail entry, like the Files plugin. The
part of the URL after the page path (`subPath`) carries the selection.

```
/plugins/terminal-hub/terminals/<projectId>/<environmentId>/<terminalId>
/plugins/terminal-hub/terminals/<projectId>/all/<terminalId>
```

## Rules

- **NAV-1** The plugin registers one `navPanel` titled "Terminals" at path `terminals`, so the page lives at `/plugins/terminal-hub/terminals`.
- **NAV-2** The URL carries the selected project, environment, and terminal; reloading the page restores all three.
- **NAV-3** Selecting a terminal adds a history entry, so back and forward move between previously selected shells.
- **NAV-4** Opening the page without a project in the URL selects the current project from `useBbContext`, or else the first project in BB's project list.
- **NAV-7** Without an environment in the URL, "All environments" is selected; the URL uses `all` in place of an environment id. (ADR 202610101721)
- **NAV-8** Changing the project or environment replaces the current history entry; only selecting a terminal adds one.
- **NAV-5** A link to a terminal that no longer exists opens its environment's list with a notice that the terminal is gone.
- **NAV-6** The page title bar shows the number of running terminals in the selected environment, or in the whole project when "All environments" is selected. (ADR 202610101629) (ADR 202610101721)

