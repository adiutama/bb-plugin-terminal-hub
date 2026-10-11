// One terminal in the list: status, title, directory, server hint, owner.
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { type HubRow, isRunning } from "@/lib/inventory";
import { shortenHome } from "@/lib/paths";
import type { ServerHint } from "@/lib/server-hint";
import { formatAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface RowActions {
  onSelect: (row: HubRow) => void;
  onRename: (row: HubRow) => void;
  onRestart: (row: HubRow) => void;
  onClose: (row: HubRow) => void;
  onDismiss: (row: HubRow) => void;
}

export function SessionRow({
  row,
  selected,
  hint,
  home,
  now,
  actions,
}: {
  row: HubRow;
  selected: boolean;
  hint: ServerHint | undefined;
  home: string | null;
  now: number;
  actions: RowActions;
}) {
  const { terminal, thread } = row;
  const running = isRunning(terminal);
  const title = terminal.title || "Terminal";
  return (
    <li
      className={cn(
        "group relative flex items-start gap-1 rounded-md pr-1",
        selected ? "bg-state-active" : "hover:bg-state-hover",
        row.stale && "bg-amber-500/10",
      )}
      data-terminal-id={terminal.id}
      data-stale={row.stale ? "" : undefined}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
        aria-current={selected ? "true" : undefined}
        data-nav-item=""
        onClick={() => actions.onSelect(row)}
      >
        {/* LIST-5: running, or exited with its code. */}
        <span
          role="img"
          aria-label={
            running
              ? "Running"
              : `Exited${terminal.exitCode === null ? "" : ` with code ${terminal.exitCode}`}`
          }
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            running ? "bg-emerald-500" : "border border-muted-foreground",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 text-sm">
            <span className="truncate">{title}</span>
            {hint ? (
              <span className="shrink-0 font-mono text-xs text-muted-foreground" title={hint.url}>
                {hint.label}
              </span>
            ) : null}
            {!running ? (
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {terminal.exitCode === null ? "exited" : `exit ${terminal.exitCode}`}
              </span>
            ) : null}
          </span>
          <span
            className="truncate font-mono text-xs text-muted-foreground"
            title={terminal.initialCwd}
          >
            {shortenHome(terminal.initialCwd, home)}
          </span>
          {thread ? (
            <span className="truncate text-xs text-muted-foreground">
              “{thread.title}” · {thread.state}
            </span>
          ) : null}
          {row.stale && thread?.inactiveSince != null ? (
            <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <span aria-hidden="true">⚠</span>
              thread {thread.state} {formatAgo(thread.inactiveSince, now)}
            </span>
          ) : null}
        </span>
      </button>
      {!running ? (
        <Button
          variant="ghost"
          size="icon"
          className="mt-1 size-7 shrink-0 text-muted-foreground"
          aria-label={`Dismiss ${title}`}
          onClick={() => actions.onDismiss(row)}
        >
          <Icon name="X" className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
      {/* ACT-1. An exited terminal is already closed: Close dismisses its row. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="mt-1 size-7 shrink-0 text-muted-foreground"
            aria-label={`Actions for ${title}`}
          >
            <Icon name="MoreHorizontal" className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => actions.onRename(row)}>Rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.onRestart(row)}>Restart shell</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => (running ? actions.onClose(row) : actions.onDismiss(row))}
          >
            Close
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
