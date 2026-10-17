// NAV-2: the selection lives in the page's subPath,
// `<projectId>/<environmentId>/<terminalId>`.

export const PANEL_PATH = "terminals";

export interface Route {
  projectId: string | null;
  environmentId: string | null;
  terminalId: string | null;
}

/** Links from before ADR 202610171354 named `all` for every environment. */
const LEGACY_ALL = "all";

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function parseRoute(subPath: string): Route {
  const [projectId, environmentId, terminalId] = subPath
    .split("/")
    .filter((part) => part !== "")
    .map(safeDecode);
  const environment = environmentId && environmentId !== LEGACY_ALL ? environmentId : null;
  return {
    projectId: projectId || null,
    environmentId: environment,
    terminalId: environment ? terminalId || null : null,
  };
}

export function formatRoute(route: Route): string {
  if (route.projectId === null) return "";
  const parts = [route.projectId];
  if (route.environmentId) {
    parts.push(route.environmentId);
    if (route.terminalId) parts.push(route.terminalId);
  }
  return parts.map(encodeURIComponent).join("/");
}
