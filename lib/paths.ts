// LIST-6: starting directories with the host's home directory shown as `~`.

/** `path` with a leading `home` replaced by `~`. Unchanged when home is unknown. */
export function shortenHome(path: string, home: string | null): string {
  if (!home || home === "/") return path;
  const base = home.endsWith("/") ? home.slice(0, -1) : home;
  if (path === base) return "~";
  if (path.startsWith(`${base}/`)) return `~${path.slice(base.length)}`;
  return path;
}
