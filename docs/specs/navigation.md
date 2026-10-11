# Navigation

- Status: implemented
- Prefix: NAV
- Decisions: 202610101629, 202610111439

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
- **NAV-4** Opening the page without a project in the URL selects the project the page last showed since bb loaded, if BB still lists it; otherwise the current project from `useBbContext`, or else the first project in BB's project list. It then restores that project's remembered place (NAV-10). (ADR 202610111439)
- **NAV-7** Without an environment in the URL, and none restored under NAV-10, "All environments" is selected; the URL uses `all` in place of an environment id. (ADR 202610111439)
- **NAV-8** Changing the project or environment replaces the current history entry; only selecting a terminal adds one.
- **NAV-5** A link to a terminal that no longer exists opens its environment's list with a notice that the terminal is gone. So does returning to the page when the selected terminal went away meanwhile (LIST-28). (ADR 202610111439)
- **NAV-6** The page title bar shows the number of running terminals in the selected environment, or in the whole project when "All environments" is selected, for the project and environment in the URL as it renders. While the list's rows are last known (LIST-27), it reads "Last known · N running". (ADR 202610101629) (ADR 202610111439)
- **NAV-9** The URL does not carry the list's filter (LIST-18), and typing in it adds or replaces no history entry. A reload starts with an empty filter; navigating within the page, back and forward included, and leaving the page and returning keep it as LIST-21 says. (ADR 202610111439)
- **NAV-10** The page remembers each project's environment and selected terminal until bb reloads. When it opens with no project in the URL, it restores the remembered place of the project NAV-4 selects, replacing the history entry (NAV-8); with nothing remembered for that project, NAV-7 applies. A URL that names a project is followed as it is, and one project's place is never used for another. (ADR 202610111439)
