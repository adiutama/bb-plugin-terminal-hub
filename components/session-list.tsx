// The left column's list: one environment's groups, or every environment's.
import type { ReactNode, Ref } from "react";
import { ACTION_BUTTON_CLASS, type RowActions, SessionRow } from "@/components/session-row";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { HubView, Section } from "@/lib/hub-store";
import type { HubRow } from "@/lib/inventory";
import { moveInList } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

export interface ListProps {
  view: HubView;
  selectedId: string | null;
  now: number;
  actions: RowActions;
  /**
   * LIST-13: the All view's sections. With a filter (LIST-18, LIST-19), the
   * sections cut to their matching rows (in a single environment, its one
   * section), and in `empty` the empty environments whose name matches.
   */
  shown: readonly Section[];
  empty: readonly Section[];
  /** The filter's text, trimmed; empty when not filtering. */
  filter: string;
  listRef: Ref<HTMLDivElement>;
  /** LIST-23: ↑ from the first item, or a filtered empty environment opened. */
  focusFilter: () => void;
  collapsed: ReadonlySet<string>;
  onToggleSection: (environmentId: string) => void;
  onSelectEnvironment: (environmentId: string) => void;
}

const MUTED_HEADING = "px-2 pt-1.5 text-[11px] tracking-wide text-muted-foreground/80";

/** LIST-2: the heading shows only when the environment shows both kinds. */
function Group({
  label,
  heading,
  children,
}: {
  label: string;
  heading: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-px">
      {heading ? <h3 className={MUTED_HEADING}>{label}</h3> : null}
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  );
}

function Rows({ rows, props }: { rows: HubRow[]; props: ListProps }) {
  const { view, selectedId, now, actions } = props;
  return rows.map((row) => (
    <SessionRow
      key={row.terminal.id}
      row={row}
      selected={row.terminal.id === selectedId}
      hint={view.hints.get(row.terminal.id)}
      home={view.homes.get(row.terminal.hostId) ?? null}
      now={now}
      actions={actions}
    />
  ));
}

/** LIST-2, LIST-10, LIST-12 for one environment. */
function EnvironmentGroups({ section, props }: { section: Section; props: ListProps }) {
  const { grouped } = section;
  const empty = grouped.environment.length === 0 && grouped.threads.length === 0;
  const both = grouped.environment.length > 0 && grouped.threads.length > 0;
  return (
    <div className="flex flex-col gap-1">
      {section.error ? (
        <p role="alert" className="px-2 pt-2 text-xs text-destructive">
          Could not list this environment's terminals: {section.error}
        </p>
      ) : null}
      {empty && !section.error ? (
        section.loaded ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            {props.filter ? noMatch(props.filter) : "No terminals here yet."}
          </p>
        ) : (
          <p className="px-2 py-3 text-sm text-muted-foreground">Loading terminals…</p>
        )
      ) : null}
      {grouped.environment.length > 0 ? (
        <Group label="Environment" heading={both}>
          <Rows rows={grouped.environment} props={props} />
        </Group>
      ) : null}
      {grouped.threads.length > 0 ? (
        <Group label="From threads" heading={both}>
          <Rows rows={grouped.threads.flatMap((group) => group.rows)} props={props} />
        </Group>
      ) : null}
    </div>
  );
}

function noMatch(filter: string): string {
  return `No terminals match “${filter}”.`;
}

/** LIST-15: the environment's name, monospace with a branch icon; selects it. */
function EnvironmentName({
  section,
  props,
  navItem = false,
}: {
  section: Section;
  props: ListProps;
  /** LIST-23: an empty environment the filter lists is in the keyboard order. */
  navItem?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex min-w-0 shrink items-center gap-1.5 rounded px-1 py-1 text-left font-mono pointer-coarse:min-h-8 text-xs font-medium text-foreground/80 underline-offset-[3px] hover:text-foreground hover:underline hover:decoration-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      title={section.environment.path}
      data-nav-item={navItem ? "" : undefined}
      onClick={() => {
        props.onSelectEnvironment(section.environment.id);
        // The header goes away with the view; keep focus in the page.
        if (navItem) props.focusFilter();
      }}
    >
      <Icon name="GitBranch" className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{section.environment.name}</span>
    </button>
  );
}

/**
 * LIST-13, LIST-15: one collapsible section per environment with something to
 * show: its name, a hairline, its running count, and the toggle on the right.
 * While filtering (LIST-19) it is open, without its toggle.
 */
function AllSection({ section, props }: { section: Section; props: ListProps }) {
  const filtering = props.filter !== "";
  const open = filtering || !props.collapsed.has(section.environment.id);
  const name = section.environment.name;
  return (
    <section aria-label={name} className="mt-2 flex flex-col first:mt-0">
      <div className="flex min-h-7 items-center gap-2 pl-1 pr-1">
        <EnvironmentName section={section} props={props} />
        <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" />
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            section.running > 0 ? "text-foreground/80" : "text-muted-foreground",
          )}
        >
          {section.running}
          <span className="sr-only"> running</span>
        </span>
        {filtering ? (
          <span className={cn(ACTION_BUTTON_CLASS, "pointer-events-none")} aria-hidden="true" />
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className={ACTION_BUTTON_CLASS}
            aria-expanded={open}
            aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
            onClick={() => props.onToggleSection(section.environment.id)}
          >
            <Icon
              name="ChevronDown"
              className={cn(
                "transition-transform duration-150 motion-reduce:transition-none",
                !open && "-rotate-90",
              )}
              aria-hidden="true"
            />
          </Button>
        )}
      </div>
      {open ? <EnvironmentGroups section={section} props={props} /> : null}
    </section>
  );
}

/**
 * LIST-17: what the first scan has got to, until the list is complete. After
 * a return, the last known rows stand in for it (LIST-27).
 */
function ScanStatus({ view }: { view: HubView }) {
  if (view.complete || (view.lastKnown && view.rows.length > 0)) return null;
  let text: string | null = null;
  if (view.scan) {
    text =
      view.scan.total === null
        ? "Scanning threads…"
        : `Scanning threads… ${view.scan.scanned} of ${view.scan.total}`;
  } else if (view.error === null) {
    text = "Loading terminals…";
  }
  return text ? (
    <p role="status" className="px-2 py-3 text-sm text-muted-foreground">
      {text}
    </p>
  ) : null;
}

/** LIST-19, LIST-20: what the filter found besides rows, in the All view. */
function FilterResults({ props }: { props: ListProps }) {
  const { view, shown, empty, filter } = props;
  if (!view.complete) return null;
  const rows = shown.some(
    (section) => section.grouped.environment.length > 0 || section.grouped.threads.length > 0,
  );
  return (
    <>
      {rows ? null : <p className="px-2 py-3 text-sm text-muted-foreground">{noMatch(filter)}</p>}
      {empty.length > 0 ? (
        <section aria-label="Empty environments" className="mt-2 flex flex-col">
          <h3 className={MUTED_HEADING}>Empty environments</h3>
          <div className="flex flex-col pl-1">
            {empty.map((section) => (
              <div key={section.environment.id} className="flex">
                <EnvironmentName section={section} props={props} navItem />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function ListBody({ props }: { props: ListProps }) {
  const { view } = props;
  if (view.environment === "all") {
    if (view.environmentsListed && view.environments?.length === 0) {
      return (
        <p className="px-2 py-3 text-sm text-muted-foreground">This project has no environments.</p>
      );
    }
    return (
      <>
        <ScanStatus view={view} />
        {props.shown.map((section) => (
          <AllSection key={section.environment.id} section={section} props={props} />
        ))}
        {props.filter !== "" ? <FilterResults props={props} /> : null}
      </>
    );
  }
  if (view.sections.length === 0) {
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        {view.environmentsListed ? "This project has no environments." : "Loading environments…"}
      </p>
    );
  }
  const [section] = props.shown;
  return section ? <EnvironmentGroups section={section} props={props} /> : null;
}

export function SessionList(props: ListProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: LIST-23 arrows move between the buttons inside; the handler only acts on keys from them.
    <div
      ref={props.listRef}
      className="flex flex-col gap-0.5"
      onKeyDown={(event) => moveInList(event, event.currentTarget, props.focusFilter)}
    >
      <ListBody props={props} />
    </div>
  );
}
