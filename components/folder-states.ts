// LIST-48: the folder checks the "New terminal in…" menus read and start.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useSyncExternalStore } from "react";
import { folderChecksFor, type MenuEnvironments, menuEnvironments } from "@/lib/folders";
import type { HubSnapshot } from "@/lib/hub";
import type { EnvironmentInfo, HubSdk } from "@/lib/hub-store";

export interface ProjectMenus {
  /** What a project's menu lists now. */
  forProject: (projectId: string) => MenuEnvironments;
  /** A menu opened: check the folders of what it would list. */
  check: (environments: readonly EnvironmentInfo[]) => void;
}

export function useProjectMenus(snapshot: HubSnapshot): ProjectMenus {
  const sdk: HubSdk = useSdk();
  const checks = folderChecksFor(sdk);
  const states = useSyncExternalStore(checks.subscribe, checks.get);
  return {
    forProject: (projectId) => {
      const view = snapshot.views.get(projectId);
      const withTerminals = new Set(
        (view?.sections ?? []).filter((s) => s.rows.length > 0).map((s) => s.environment.id),
      );
      return menuEnvironments(view?.environments ?? [], (id) => withTerminals.has(id), states);
    },
    check: (environments) => checks.check(environments),
  };
}
