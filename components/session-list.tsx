// The left column's list: one environment's groups, or every environment's.
import type { ReactNode, Ref } from "react";
import { type RowActions, SessionRow } from "@/components/session-row";
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
   * LIST-13: the All view's sections, and the environments hidden as empty.
   * With a filter (LIST-18, LIST-19), the sections cut to their matching rows
   * (in a single environment, its one section), and the empty environments
   * whose name matches.
   */
  shown: readonly Section[];
  empty: readonly Section[];
  /** The filter's text, trimmed; empty when not filtering. */
  filter: string;
  listRef: Ref<HTMLDivElement>;
  /** LIST-23: ↑ from the first item, or a filtered empty environment opened. */
  focusFilter: () => void;
  collapsed: ReadonlySet<string>;
  showEmpty: boolean;
  onToggleSection: (environmentId: string) => void;
  onToggleEmpty: () => void;
  onSelectEnvironment: (environmentId: string) => void;
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-0.5">
      <h3 className="px-2 pt-2 text-xs font-medium text-muted-foreground">{label}</h3>
      <ul className="flex flex-col gap-0.5">{children}</ul>
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
        <Group label="Environment">
          <Rows rows={grouped.environment} props={props} />
        </Group>
      ) : null}
      {grouped.threads.length > 0 ? (
        <Group label="From threads">
          <Rows rows={grouped.threads.flatMap((group) => group.rows)} props={props} />
        </Group>
      ) : null}
    </div>
  );
}

function noMatch(filter: string): string {
  return `No terminals match “${filter}”.`;
}

function SectionHeader({
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
      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-sm font-medium"
      title={section.environment.path}
      data-nav-item={navItem ? "" : undefined}
      onClick={() => {
        props.onSelectEnvironment(section.environment.id);
        // The header goes away with the view; keep focus in the page.
        if (navItem) props.focusFilter();
      }}
    >
      <span className="truncate">{section.environment.name}</span>
      <span
        className={cn(
          "ml-auto shrink-0 text-xs tabular-nums",
          section.running > 0 ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {section.running} running
      </span>
    </button>
  );
}

/**
 * LIST-13, LIST-15: one collapsible section per environment with something to
 * show. While filtering (LIST-19) it is open, without its toggle.
 */
function AllSection({ section, props }: { section: Section; props: ListProps }) {
  const filtering = props.filter !== "";
  const open = filtering || !props.collapsed.has(section.environment.id);
  const name = section.environment.name;
  return (
    <section aria-label={name} className="flex flex-col">
      <div className="flex items-center gap-1 rounded-md hover:bg-state-hover">
        {filtering ? (
          <span className="size-7 shrink-0" aria-hidden="true" />
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            aria-expanded={open}
            aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
            onClick={() => props.onToggleSection(section.environment.id)}
          >
            <Icon
              name={open ? "ChevronDown" : "ChevronRight"}
              className="size-4"
              aria-hidden="true"
            />
          </Button>
        )}
        <SectionHeader section={section} props={props} />
      </div>
      {open ? (
        <div className="pl-4">
          <EnvironmentGroups section={section} props={props} />
        </div>
      ) : null}
    </section>
  );
}

/** LIST-17: what the first scan has got to, until the list is complete. */
function ScanStatus({ view }: { view: HubView }) {
  if (view.complete) return null;
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

/** LIST-13: the empty environments, behind one disclosure. */
function EmptyEnvironments({ props }: { props: ListProps }) {
  const { empty, showEmpty } = props;
  return (
    <div className="flex flex-col">
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-1 px-1 text-muted-foreground"
        aria-expanded={showEmpty}
        onClick={props.onToggleEmpty}
      >
        <Icon
          name={showEmpty ? "ChevronDown" : "ChevronRight"}
          className="size-4"
          aria-hidden="true"
        />
        {showEmpty
          ? "Hide empty environments"
          : `Show ${empty.length} empty environment${empty.length === 1 ? "" : "s"}`}
      </Button>
      {showEmpty ? (
        <section aria-label="Empty environments" className="flex flex-col pl-7">
          {empty.map((section) => (
            <div key={section.environment.id} className="flex rounded-md hover:bg-state-hover">
              <SectionHeader section={section} props={props} />
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
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
        <section aria-label="Empty environments" className="flex flex-col">
          <h3 className="px-2 pt-2 text-xs font-medium text-muted-foreground">
            Empty environments
          </h3>
          <div className="flex flex-col pl-7">
            {empty.map((section) => (
              <div key={section.environment.id} className="flex rounded-md hover:bg-state-hover">
                <SectionHeader section={section} props={props} navItem />
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
    if (view.environments !== null && view.environments.length === 0) {
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
        {props.filter !== "" ? (
          <FilterResults props={props} />
        ) : view.complete && props.empty.length > 0 ? (
          <EmptyEnvironments props={props} />
        ) : null}
      </>
    );
  }
  if (view.sections.length === 0) {
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        {view.environments === null ? "Loading environments…" : "This project has no environments."}
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
      className="flex flex-col gap-1"
      onKeyDown={(event) => moveInList(event, event.currentTarget, props.focusFilter)}
    >
      <ListBody props={props} />
    </div>
  );
}
