// LIST-25: the main pane with nothing to show, and with nothing running
// anywhere, a way to start a shell in any environment.
import type { ReactNode } from "react";
import { CheckingFolders } from "@/components/environment-rail";
import { useProjectMenus } from "@/components/folder-states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import type { HubSnapshot } from "@/lib/hub";
import type { Place } from "@/lib/rail";

export function EmptyPane({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center text-[13px] text-muted-foreground">
      <span className="grid size-11 place-items-center rounded-xl bg-foreground/[0.04] text-foreground/80">
        <Icon name="Terminal" className="size-5" aria-hidden="true" />
      </span>
      <p className="text-foreground/90">{message}</p>
      {children}
    </div>
  );
}

/**
 * LIST-25, LIST-48: every project's environments whose folder may hold a
 * shell, grouped by project in bb's order, checked when the menu opens.
 */
export function NewTerminalMenu({
  snapshot,
  creating,
  onCreate,
}: {
  snapshot: HubSnapshot;
  creating: boolean;
  onCreate: (place: Place) => void;
}) {
  const menus = useProjectMenus(snapshot);
  const lists = (snapshot.projects ?? []).map((project) => ({
    project,
    menu: menus.forProject(project.id),
  }));
  const projects = lists.flatMap(({ project, menu }) =>
    menu.shown.length > 0 ? [{ project, environments: menu.shown }] : [],
  );
  const checking = lists.some(({ menu }) => menu.checking);
  const candidates = lists.reduce((sum, { project }) => {
    return sum + (snapshot.views.get(project.id)?.environments?.length ?? 0);
  }, 0);
  return (
    <DropdownMenu
      onOpenChange={(open) => open && menus.check(lists.flatMap(({ menu }) => menu.unchecked))}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={creating || candidates === 0}>
          <Icon name="Plus" aria-hidden="true" />
          New terminal in…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="max-h-96 max-w-80 overflow-y-auto">
        {projects.map(({ project, environments }, index) => (
          <DropdownMenuGroup key={project.id} aria-label={project.name}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{project.name}</DropdownMenuLabel>
            {environments.map((env) => (
              <DropdownMenuItem
                key={env.id}
                onSelect={() => onCreate({ projectId: project.id, environmentId: env.id })}
              >
                <Icon
                  name="GitBranch"
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="truncate font-mono text-[12px]" title={`${env.name}\n${env.path}`}>
                  {env.name}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
        {checking ? <CheckingFolders /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
