// NAV-6: the running count in the page's title bar, read from the page's store.
import { useSyncExternalStore } from "react";
import {
  getActiveHubStore,
  type HubStore,
  type HubView,
  subscribeActiveHubStore,
} from "@/lib/hub-store";

const noView = (): HubView | null => null;
const noSubscription = () => () => {};

export function HeaderCount() {
  const store: HubStore | null = useSyncExternalStore(subscribeActiveHubStore, getActiveHubStore);
  const view = useSyncExternalStore(store?.subscribe ?? noSubscription, store?.getView ?? noView);
  if (!view || view.projectId === null) return null;
  const scope = view.environment === "all" ? "in this project" : "in this environment";
  return (
    <span className="text-xs tabular-nums text-muted-foreground" title={`Running ${scope}`}>
      {view.running} running
    </span>
  );
}
