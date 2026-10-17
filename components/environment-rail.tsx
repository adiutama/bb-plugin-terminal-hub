// The left rail: "Find environment", then bb's projects with their
// environments that have terminals (LIST-33 to LIST-35, LIST-41 to LIST-45).
import { type KeyboardEvent, type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import type { HubSnapshot, ProjectRecord } from "@/lib/hub";
import type { EnvironmentInfo } from "@/lib/hub-store";
import { applyScrollAnchor, type PageMemory, readScrollAnchor } from "@/lib/page-memory";
import { filterRail, findWords, type Place, type RailGroup } from "@/lib/rail";
import { cn } from "@/lib/utils";

/** The 44px band the rail's find field shares with the tab strip. */
export const BAND_CLASS = "h-11 shrink-0 border-b border-foreground/8";
/** bb's sidebar tone, from its theme tokens. */
export const SIDEBAR_TONE_CLASS = "bg-[color-mix(in_oklch,var(--foreground)_4%,var(--background))]";

const ITEM = "[data-rail-item]";

function railItems(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(ITEM)) : [];
}

/**
 * LIST-29: puts the environment that was at the top of the rail back where it
 * was, once; if it is gone, the rail starts at the top. Scrolling is recorded
 * until bb reloads.
 */
function useRememberedScroll(
  scroller: RefObject<HTMLDivElement | null>,
  memory: PageMemory,
  itemCount: number,
) {
  const restored = useRef(false);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || restored.current) return;
    const anchor = memory.scroll;
    if (anchor !== null && applyScrollAnchor(element, anchor)) {
      restored.current = true;
      return;
    }
    // Nothing remembered, or the anchor is not listed once the rail has items.
    if (anchor === null || itemCount > 0) {
      element.scrollTop = 0;
      restored.current = true;
    }
  });
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let frame = 0;
    const record = () => {
      frame = 0;
      if (restored.current) memory.scroll = readScrollAnchor(element);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(record);
    };
    element.addEventListener("scroll", onScroll);
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
        if (element.isConnected) record();
      }
    };
  }, [scroller, memory]);
}

/** LIST-41: a project's "New terminal in…" menu, every environment included. */
function NewTerminalIn({
  project,
  environments,
  creating,
  onCreate,
}: {
  project: ProjectRecord;
  environments: readonly EnvironmentInfo[];
  creating: boolean;
  onCreate: (environmentId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`New terminal in ${project.name}…`}
          title="New terminal in…"
          disabled={creating}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-foreground/6 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none pointer-coarse:size-9 pointer-coarse:opacity-100"
        >
          <Icon name="Plus" className="size-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-80">
        <DropdownMenuLabel>New terminal in…</DropdownMenuLabel>
        {environments.map((env) => (
          <DropdownMenuItem key={env.id} onSelect={() => onCreate(env.id)}>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface RailProps {
  snapshot: HubSnapshot;
  /** The rail as LIST-33 lists it, before "Find environment". */
  groups: readonly RailGroup[];
  selected: Place | null;
  find: string;
  onFind: (text: string) => void;
  findRef: RefObject<HTMLInputElement | null>;
  folded: ReadonlySet<string>;
  onToggleProject: (projectId: string) => void;
  onSelect: (place: Place) => void;
  creating: boolean;
  onCreate: (place: Place) => void;
  memory: PageMemory;
}

export function EnvironmentRail({
  snapshot,
  groups,
  selected,
  find,
  onFind,
  findRef,
  folded,
  onToggleProject,
  onSelect,
  creating,
  onCreate,
  memory,
}: RailProps) {
  const words = findWords(find);
  const finding = words.length > 0;
  const shown = filterRail(
    groups,
    words,
    (projectId) => snapshot.views.get(projectId)?.hints ?? new Map(),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // LIST-35, LIST-42: what each project shows: everything while finding,
  // only the selected environment while folded.
  const visible = shown.map((group) => {
    const open = finding || !folded.has(group.project.id);
    const environments = open
      ? group.environments
      : group.environments.filter((entry) => entry.environment.id === selected?.environmentId);
    return { group, open, environments };
  });
  const firstShown = visible.flatMap((v) => v.environments)[0];
  useRememberedScroll(
    scrollerRef,
    memory,
    visible.reduce((sum, v) => sum + v.environments.length, 0),
  );

  // LIST-45: ↓ and ↑ between environments, without wrapping; ↑ from the first
  // returns to the find field. Moving focus does not select.
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(ITEM)) return;
    const items = railItems(listRef.current);
    const index = items.indexOf(target);
    if (index === -1) return;
    event.preventDefault();
    if (event.key === "ArrowDown") (items[index + 1] ?? target).focus();
    else if (index === 0) findRef.current?.focus();
    else items[index - 1]?.focus();
  };

  // LIST-44: Escape clears, then moves to the selected environment; ↓ enters
  // the rail; Enter selects the first environment shown.
  const onFindKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (find !== "") onFind("");
      else listRef.current?.querySelector<HTMLElement>(`${ITEM}[aria-current="true"]`)?.focus();
    } else if (event.key === "ArrowDown") {
      const first = railItems(listRef.current)[0];
      if (first) {
        event.preventDefault();
        first.focus();
      }
    } else if (event.key === "Enter" && firstShown) {
      event.preventDefault();
      onSelect({ projectId: firstShown.projectId, environmentId: firstShown.environment.id });
    }
  };

  const progress = snapshot.progress;
  return (
    <nav
      aria-label="Environments"
      className={cn(
        "flex w-[240px] shrink-0 flex-col border-r border-foreground/8",
        SIDEBAR_TONE_CLASS,
      )}
    >
      <label className={cn(BAND_CLASS, "flex items-center gap-2 pl-4 pr-3 text-muted-foreground")}>
        <Icon name="Search" className="size-3.5 shrink-0" aria-hidden="true" />
        <input
          ref={findRef}
          type="text"
          value={find}
          onChange={(event) => onFind(event.target.value)}
          onKeyDown={onFindKey}
          placeholder="Find environment"
          aria-label="Find environment"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {find === "" ? (
          <kbd
            title="Press / to find"
            className="hidden rounded border border-foreground/12 px-1.5 py-0.5 font-sans text-[11px] leading-none pointer-fine:inline"
          >
            /
          </kbd>
        ) : null}
      </label>
      {/* LIST-27: what is shown is kept from before a return, until confirmed. */}
      {snapshot.lastKnown ? (
        <p
          role="status"
          data-rail-freshness=""
          className="shrink-0 border-b border-foreground/8 px-4 py-1.5 text-[12px] text-muted-foreground"
        >
          {snapshot.reconnecting ? "Reconnecting…" : "Updating…"}
        </p>
      ) : null}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 pt-1">
        {progress ? (
          <p role="status" className="px-2 pt-2 text-[12.5px] text-muted-foreground">
            Looking for terminals…
            {progress.total !== null && progress.total > 0
              ? ` ${progress.listed} of ${progress.total} projects`
              : ""}
          </p>
        ) : null}
        {snapshot.projectsError ? (
          <p role="alert" className="px-2 pt-2 text-[12.5px] text-destructive">
            Could not list projects: {snapshot.projectsError}
          </p>
        ) : null}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move focus between the environment buttons inside. */}
        <div ref={listRef} onKeyDown={onListKey}>
          {visible.map(({ group, open, environments }) => (
            <div key={group.project.id} className="mt-2 flex flex-col gap-px">
              <div className="group flex h-7 items-center pr-0.5 pointer-coarse:h-9">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => onToggleProject(group.project.id)}
                  className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-md pl-0.5 text-left text-[13px] font-medium text-foreground/80 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Icon
                    name={open ? "ChevronDown" : "ChevronRight"}
                    className="size-3.5 shrink-0 text-muted-foreground/70"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate" title={group.project.name}>
                    {group.project.name}
                  </span>
                </button>
                <NewTerminalIn
                  project={group.project}
                  environments={snapshot.views.get(group.project.id)?.environments ?? []}
                  creating={creating}
                  onCreate={(environmentId) =>
                    onCreate({ projectId: group.project.id, environmentId })
                  }
                />
              </div>
              {group.error ? (
                <p role="alert" className="ml-5 text-[12px] text-destructive">
                  {group.error}
                </p>
              ) : null}
              {environments.map((entry) => {
                const active = entry.environment.id === selected?.environmentId;
                const running = entry.section.running;
                return (
                  <button
                    key={entry.environment.id}
                    type="button"
                    data-rail-item=""
                    data-environment-id={entry.environment.id}
                    aria-current={active ? "true" : undefined}
                    title={`${entry.environment.name}\n${entry.environment.path}`}
                    onClick={() =>
                      onSelect({ projectId: entry.projectId, environmentId: entry.environment.id })
                    }
                    className={cn(
                      "ml-3 flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-coarse:h-9",
                      active
                        ? "bg-foreground/10 text-foreground"
                        : "text-foreground/75 hover:bg-foreground/5 hover:text-foreground",
                    )}
                  >
                    <Icon
                      name="GitBranch"
                      className="size-3 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                      {entry.environment.name}
                    </span>
                    {running > 0 ? (
                      <span
                        className="text-[12px] tabular-nums text-muted-foreground"
                        title={`${running} running`}
                      >
                        {running}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {finding && shown.length === 0 ? (
          <p className="px-2 pt-4 text-[12.5px] text-muted-foreground">
            No environment matches “{find.trim()}”.
          </p>
        ) : null}
      </div>
    </nav>
  );
}
