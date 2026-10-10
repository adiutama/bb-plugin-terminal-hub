// NAV-2, NAV-7: the selection lives in the page's subPath,
// `<projectId>/<environmentId | all>/<terminalId>`.

export const PANEL_PATH = "terminals";
export const ALL = "all";

export interface Route {
  projectId: string | null;
  /** An environment id, or `all` for every environment in the project. */
  environment: string;
  terminalId: string | null;
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function parseRoute(subPath: string): Route {
  const [projectId, environment, terminalId] = subPath
    .split("/")
    .filter((part) => part !== "")
    .map(safeDecode);
  return {
    projectId: projectId || null,
    environment: environment || ALL,
    terminalId: terminalId || null,
  };
}

export function formatRoute(route: Route): string {
  if (route.projectId === null) return "";
  const parts = [route.projectId, route.environment || ALL];
  if (route.terminalId) parts.push(route.terminalId);
  return parts.map(encodeURIComponent).join("/");
}
