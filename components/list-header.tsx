// Above the list: the New terminal split button and the summary line.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { menuEnvironments, type Summary } from "@/lib/all-view";
import type { EnvironmentInfo } from "@/lib/hub-store";

/**
 * LIST-9: the main part starts a shell in `targetId`, or opens the menu when
 * there is none; ▾ opens "New terminal in…" with the target first.
 */
export function NewTerminalButton({
  environments,
  targetId,
  creating,
  onCreate,
}: {
  environments: readonly EnvironmentInfo[];
  targetId: string | null;
  creating: string | null;
  onCreate: (environmentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { first, rest } = menuEnvironments(environments, targetId);
  const item = (env: EnvironmentInfo) => (
    <DropdownMenuItem key={env.id} title={env.path} onSelect={() => onCreate(env.id)}>
      <span className="truncate">{env.name}</span>
    </DropdownMenuItem>
  );
  return (
    <div className="flex">
      <Button
        variant="outline"
        size="sm"
        className="min-w-0 flex-1 justify-start rounded-r-none"
        disabled={creating !== null}
        onClick={() => (targetId === null ? setOpen(true) : onCreate(targetId))}
      >
        <Icon name="Plus" className="size-4" aria-hidden="true" />
        {creating !== null ? "Starting…" : "New terminal"}
      </Button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="rounded-l-none border-l-0 px-2"
            disabled={creating !== null || environments.length === 0}
            aria-label="New terminal in…"
          >
            <Icon name="ChevronDown" className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          mobileTitle="New terminal in…"
          className="max-h-80 w-64 overflow-y-auto"
        >
          <DropdownMenuLabel>New terminal in…</DropdownMenuLabel>
          {first ? item(first) : null}
          {first && rest.length > 0 ? <DropdownMenuSeparator /> : null}
          {rest.map(item)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** LIST-16: "N running · N servers · N stale"; stale opens ACT-5's confirmation. */
export function SummaryLine({ summary, onStale }: { summary: Summary; onStale: () => void }) {
  return (
    <section
      aria-label="Summary"
      className="flex flex-wrap items-center gap-x-1.5 px-1 text-xs text-muted-foreground"
    >
      <span className={summary.running > 0 ? "text-foreground" : undefined}>
        {summary.running} running
      </span>
      {summary.servers > 0 ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{plural(summary.servers, "server")}</span>
        </>
      ) : null}
      {summary.stale > 0 ? (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
            title="Close all from settled threads"
            onClick={onStale}
          >
            {summary.stale} stale
          </button>
        </>
      ) : null}
    </section>
  );
}
