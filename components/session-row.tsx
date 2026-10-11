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

/** A small monospace label: a server hint or an exit code. */
export const PILL_CLASS = "shrink-0 rounded-[5px] px-1.5 font-mono text-[11px] leading-[18px]";
export const SERVER_PILL_CLASS = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";

export function exitPillClass(exitCode: number | null): string {
  return exitCode !== null && exitCode !== 0
    ? "bg-red-500/10 text-red-700 dark:text-red-400"
    : "bg-foreground/5 text-muted-foreground";
}

export function exitLabel(exitCode: number | null): string {
  return exitCode === null ? "exited" : `exit ${exitCode}`;
}

/**
 * LIST-24: shown on hover, focus within the row, an open menu, or the
 * selected row; always with a coarse pointer. Hidden by opacity only, so the
 * buttons keep their space and their place in the Tab order.
 */
const ACTIONS_REVEAL =
  "opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100 group-has-[[data-state=open]]:opacity-100 pointer-coarse:opacity-100";

/** Row and bar icon buttons: 28px, 36px on a coarse pointer. */
export const ACTION_BUTTON_CLASS =
  "size-7 shrink-0 rounded-md text-muted-foreground pointer-coarse:size-9 [&_[data-icon-root]]:size-3.5";

/** LIST-5: green running, amber stale, a ring when exited (red unless 0). */
function StatusDot({ row, running }: { row: HubRow; running: boolean }) {
  const { exitCode } = row.terminal;
  return (
    <span
      role="img"
      aria-label={
        running ? "Running" : `Exited${exitCode === null ? "" : ` with code ${exitCode}`}`
      }
      data-status={running ? (row.stale ? "stale" : "running") : exitCode ? "failed" : "exited"}
      className={cn(
        "mt-[5px] size-2 shrink-0 rounded-full",
        running
          ? row.stale
            ? "bg-amber-500 shadow-[0_0_0_3px] shadow-amber-500/15"
            : "bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/15"
          : exitCode
            ? "border-[1.5px] border-red-500"
            : "border-[1.5px] border-muted-foreground/60",
      )}
    />
  );
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
        "group relative flex items-start gap-1 rounded-lg pr-1",
        selected ? "bg-state-active" : "hover:bg-state-hover",
      )}
      data-terminal-id={terminal.id}
      data-stale={row.stale ? "" : undefined}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-current={selected ? "true" : undefined}
        data-nav-item=""
        onClick={() => actions.onSelect(row)}
      >
        <StatusDot row={row} running={running} />
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "truncate text-[13.5px] font-medium",
                !running && "text-muted-foreground",
              )}
            >
              {title}
            </span>
            {hint ? (
              <span className={cn(PILL_CLASS, SERVER_PILL_CLASS)} title={hint.url}>
                {hint.label}
              </span>
            ) : null}
            {!running ? (
              <span className={cn(PILL_CLASS, exitPillClass(terminal.exitCode))}>
                {exitLabel(terminal.exitCode)}
              </span>
            ) : null}
          </span>
          <span
            className="truncate font-mono text-[11.5px] text-muted-foreground"
            title={terminal.initialCwd}
          >
            {shortenHome(terminal.initialCwd, home)}
          </span>
          {thread ? (
            <span
              className={cn(
                "flex min-w-0 items-center gap-1.5 text-xs",
                row.stale ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
              )}
            >
              <Icon
                name={row.stale ? "TriangleAlert" : "MessageSquare"}
                fallback={row.stale ? "AlertTriangle" : "MessageCircle"}
                className="size-3 shrink-0"
                aria-label={row.stale ? "Stale: its thread is no longer active" : "Thread"}
              />
              <span className="truncate">{thread.title}</span>
              {/* LIST-3, LIST-4: the thread's state, and for a stale row how long ago. */}
              <span className={cn("shrink-0", !row.stale && "opacity-70")}>
                · {thread.state}
                {row.stale && thread.inactiveSince != null
                  ? ` ${formatAgo(thread.inactiveSince, now)} ago`
                  : ""}
              </span>
            </span>
          ) : null}
        </span>
      </button>
      <span
        className={cn("mt-1 flex shrink-0 items-center", !selected && ACTIONS_REVEAL)}
        data-row-actions=""
      >
        {!running ? (
          <Button
            variant="ghost"
            size="icon"
            className={ACTION_BUTTON_CLASS}
            aria-label={`Dismiss ${title}`}
            onClick={() => actions.onDismiss(row)}
          >
            <Icon name="X" aria-hidden="true" />
          </Button>
        ) : null}
        {/* ACT-1. An exited terminal is already closed: Close dismisses its row. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={ACTION_BUTTON_CLASS}
              aria-label={`Actions for ${title}`}
            >
              <Icon name="MoreHorizontal" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => actions.onRename(row)}>Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.onRestart(row)}>
              Restart shell
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => (running ? actions.onClose(row) : actions.onDismiss(row))}
            >
              Close
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </li>
  );
}
