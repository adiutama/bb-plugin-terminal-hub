// "New terminal in…": a searchable list of environments to start a shell in
// (LIST-50), for one project (LIST-41) or every project (LIST-25, LIST-49).
// Folders are checked when it opens (LIST-48).
import * as Popover from "@radix-ui/react-popover";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useProjectMenus } from "@/components/folder-states";
import { Icon } from "@/components/ui/icon";
import type { HubSnapshot, ProjectRecord } from "@/lib/hub";
import type { EnvironmentInfo } from "@/lib/hub-store";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { findWords, type Place } from "@/lib/rail";
import { cn } from "@/lib/utils";

/** LIST-50: every word appears in the environment's name or its project's. */
export function menuMatches(
  words: readonly string[],
  environment: EnvironmentInfo,
  project: ProjectRecord,
): boolean {
  const haystack = `${environment.name}\n${project.name}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function NewTerminalMenu({
  snapshot,
  projectIds,
  creating,
  onCreate,
  align = "start",
  children,
}: {
  snapshot: HubSnapshot;
  /** The projects whose environments it offers; every project when left out. */
  projectIds?: readonly string[];
  creating: boolean;
  onCreate: (place: Place) => void;
  align?: "start" | "center" | "end";
  /** The trigger. */
  children: ReactNode;
}) {
  const menus = useProjectMenus(snapshot);
  const scopeProps = usePortalScopeProps();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const lists = (snapshot.projects ?? [])
    .filter((project) => projectIds === undefined || projectIds.includes(project.id))
    .map((project) => ({ project, menu: menus.forProject(project.id) }));
  const words = findWords(query);
  const groups = lists.flatMap(({ project, menu }) => {
    const environments = menu.shown.filter((env) => menuMatches(words, env, project));
    return environments.length > 0 ? [{ project, environments }] : [];
  });
  const options = groups.flatMap(({ project, environments }) =>
    environments.map((environment) => ({ project, environment })),
  );
  const checking = lists.some(({ menu }) => menu.checking);
  const index = Math.min(active, options.length - 1);
  const highlighted = index >= 0 ? options[index] : undefined;
  const optionId = (environmentId: string) => `${listId}-${environmentId}`;

  useEffect(() => {
    if (!highlighted) return;
    const element = document.getElementById(optionId(highlighted.environment.id));
    element?.scrollIntoView?.({ block: "nearest" });
  });

  const choose = (place: Place) => {
    setOpen(false);
    onCreate(place);
  };

  // LIST-50: ↑ ↓ move the highlight, Enter starts a shell in it; Escape is
  // the popover's own and closes it.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(index + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (highlighted && !creating) {
        choose({ projectId: highlighted.project.id, environmentId: highlighted.environment.id });
      }
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setQuery("");
        setActive(0);
        menus.check(lists.flatMap(({ menu }) => menu.unchecked));
      }}
    >
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          {...scopeProps}
          aria-label="New terminal in…"
          align={align}
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          className="z-50 flex w-80 max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <div className="flex items-center gap-2 border-b border-foreground/8 px-3">
            <Icon
              name="Search"
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="New terminal in…"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={highlighted ? optionId(highlighted.environment.id) : undefined}
              placeholder="New terminal in…"
              spellCheck={false}
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Environments"
            className="max-h-80 overflow-y-auto p-1"
          >
            {groups.map(({ project, environments }) => (
              // biome-ignore lint/a11y/useSemanticElements: a listbox groups its options with role="group".
              <div key={project.id} role="group" aria-label={project.name}>
                <div
                  role="presentation"
                  className="truncate px-2 pb-0.5 pt-1.5 text-[11.5px] font-medium text-muted-foreground"
                >
                  {project.name}
                </div>
                {environments.map((environment) => {
                  const selected = highlighted?.environment.id === environment.id;
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: the search field owns the keys (aria-activedescendant).
                    <div
                      key={environment.id}
                      id={optionId(environment.id)}
                      role="option"
                      tabIndex={-1}
                      aria-selected={selected}
                      title={`${environment.name}\n${environment.path}`}
                      onPointerMove={() =>
                        setActive(options.findIndex((o) => o.environment.id === environment.id))
                      }
                      onClick={() =>
                        !creating &&
                        choose({ projectId: project.id, environmentId: environment.id })
                      }
                      className={cn(
                        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-[13px]",
                        selected && "bg-state-hover text-foreground",
                      )}
                    >
                      <Icon
                        name="GitBranch"
                        className="size-3 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 truncate font-mono text-[12px]">
                        {environment.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
            {options.length === 0 && words.length > 0 ? (
              <p className="px-2 py-1.5 text-[12.5px] text-muted-foreground">
                No environment matches “{query.trim()}”.
              </p>
            ) : null}
            {checking ? (
              <p role="status" className="px-2 py-1.5 text-[12px] text-muted-foreground">
                Checking folders…
              </p>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
