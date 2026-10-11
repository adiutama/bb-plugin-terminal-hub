// The left column's list: one environment's groups, or every environment's.
import { type ReactNode, useState } from "react";
import { type RowActions, SessionRow } from "@/components/session-row";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { HubView, Section } from "@/lib/hub-store";
import type { HubRow } from "@/lib/inventory";
import { cn } from "@/lib/utils";

export interface ListProps {
  view: HubView;
  selectedId: string | null;
  now: number;
  actions: RowActions;
  creating: string | null;
  onNewTerminal: (environmentId: string) => void;
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

function NewTerminalButton({ section, props }: { section: Section; props: ListProps }) {
  const busy = props.creating === section.environment.id;
  return (
    <Button
      variant="outline"
      size="sm"
      className="mx-2 mt-2 justify-start"
      disabled={busy}
      onClick={() => props.onNewTerminal(section.environment.id)}
    >
      <Icon name="Plus" className="size-4" aria-hidden="true" />
      {busy ? "Starting…" : "New terminal"}
    </Button>
  );
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
          <p className="px-2 py-3 text-sm text-muted-foreground">No terminals here yet.</p>
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
      <NewTerminalButton section={section} props={props} />
    </div>
  );
}

/** LIST-13, LIST-15: one collapsible section per environment. */
function AllSection({ section, props }: { section: Section; props: ListProps }) {
  const count =
    section.grouped.environment.length +
    section.grouped.threads.reduce((sum, group) => sum + group.rows.length, 0);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  // Empty sections start collapsed, unless listing them failed (LIST-13).
  const open = expanded ?? (count > 0 || section.error !== null);
  const name = section.environment.name;
  return (
    <section aria-label={name} className="flex flex-col">
      <div className="flex items-center gap-1 rounded-md hover:bg-state-hover">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          aria-expanded={open}
          aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
          onClick={() => setExpanded(!open)}
        >
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            className="size-4"
            aria-hidden="true"
          />
        </Button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-sm font-medium"
          title={section.environment.path}
          onClick={() => props.onSelectEnvironment(section.environment.id)}
        >
          <span className="truncate">{name}</span>
          <span
            className={cn(
              "ml-auto shrink-0 text-xs tabular-nums",
              section.running > 0 ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {section.running} running
          </span>
        </button>
      </div>
      {open ? (
        <div className="pl-4">
          <EnvironmentGroups section={section} props={props} />
        </div>
      ) : null}
    </section>
  );
}

export function SessionList(props: ListProps) {
  const { view } = props;
  if (view.sections.length === 0) {
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        {view.environments === null ? "Loading environments…" : "This project has no environments."}
      </p>
    );
  }
  if (view.environment === "all") {
    return (
      <div className="flex flex-col gap-1">
        {view.sections.map((section) => (
          <AllSection key={section.environment.id} section={section} props={props} />
        ))}
      </div>
    );
  }
  const [section] = view.sections;
  return section ? <EnvironmentGroups section={section} props={props} /> : null;
}
