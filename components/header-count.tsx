// NAV-6: where the user is, `project / environment`, and how many terminals
// run there, in the page's title bar. It reads the page's hub as it renders,
// for the project and environment in the URL, and never starts requests.
import { type PluginNavPanelProps, useSdk } from "@get-bb/plugin-sdk/app";
import { useSyncExternalStore } from "react";
import { hubFor } from "@/lib/hub";
import type { HubSdk } from "@/lib/hub-store";
import { parseRoute } from "@/lib/route";

export function HeaderCount({ subPath }: PluginNavPanelProps) {
  const sdk: HubSdk = useSdk();
  const hub = hubFor(sdk);
  const snapshot = useSyncExternalStore(hub.subscribe, hub.getSnapshot);
  const { projectId, environmentId } = parseRoute(subPath);
  if (projectId === null || environmentId === null) return null;
  const project = snapshot.projects?.find((p) => p.id === projectId);
  const view = snapshot.views.get(projectId);
  const section = view?.sections.find((s) => s.environment.id === environmentId);
  if (!project || !section) return null;
  const running = section.running;
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span
        data-header-place=""
        className="min-w-0 truncate"
        title={`${project.name} / ${section.environment.name}`}
      >
        {project.name} / <span className="font-mono">{section.environment.name}</span>
      </span>
      <span
        data-header-count=""
        className="shrink-0 tabular-nums"
        title={snapshot.lastKnown ? "Last known; checking again" : "Running in this environment"}
      >
        {snapshot.lastKnown ? `Last known · ${running} running` : `${running} running`}
      </span>
    </span>
  );
}
