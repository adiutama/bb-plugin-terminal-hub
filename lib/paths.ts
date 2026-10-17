// VIEW-9: starting folders, relative to the environment or with `~` for home.

/** `path` with a leading `home` replaced by `~`. Unchanged when home is unknown. */
export function shortenHome(path: string, home: string | null): string {
  if (!home || home === "/") return path;
  const base = home.endsWith("/") ? home.slice(0, -1) : home;
  if (path === base) return "~";
  if (path.startsWith(`${base}/`)) return `~${path.slice(base.length)}`;
  return path;
}

/**
 * VIEW-9: the starting folder as the bar shows it: relative to the
 * environment's path when inside it, empty when it is that path, and with the
 * home directory as `~` otherwise.
 */
export function folderLabel(cwd: string, environmentPath: string, home: string | null): string {
  const base = environmentPath.endsWith("/") ? environmentPath.slice(0, -1) : environmentPath;
  if (base !== "") {
    if (cwd === base || cwd === `${base}/`) return "";
    if (cwd.startsWith(`${base}/`)) return cwd.slice(base.length + 1);
  }
  return shortenHome(cwd, home);
}
