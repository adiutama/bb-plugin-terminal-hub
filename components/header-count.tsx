// NAV-6: the running count in the page's title bar. It takes the store for
// the project and environment in the URL as it renders, so it never shows
// another project's count, and it never starts requests of its own.
import { type PluginNavPanelProps, useSdk } from "@get-bb/plugin-sdk/app";
import { useSyncExternalStore } from "react";
import { type HubSdk, type HubStore, type HubView, hubStoreFor } from "@/lib/hub-store";
import { ALL, parseRoute } from "@/lib/route";

const noView = (): HubView | null => null;
const noSubscription = () => () => {};

export function HeaderCount({ subPath }: PluginNavPanelProps) {
  const sdk: HubSdk = useSdk();
  const route = parseRoute(subPath);
  const store: HubStore | null = route.projectId ? hubStoreFor(sdk, route.projectId) : null;
  const view = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    store ? () => store.viewFor(route.environment) : noView,
  );
  if (!view) return null;
  const scope = view.environment === ALL ? "in this project" : "in this environment";
  return (
    <span
      className="text-xs tabular-nums text-muted-foreground"
      title={view.lastKnown ? `Last known; checking again` : `Running ${scope}`}
    >
      {view.lastKnown ? `Last known · ${view.running} running` : `${view.running} running`}
    </span>
  );
}
