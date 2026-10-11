// The bar above the selected terminal: what it is, and what can be done to it.
// It sits outside the terminal view, so its keys never reach the shell.
import {
  ACTION_BUTTON_CLASS,
  exitLabel,
  exitPillClass,
  PILL_CLASS,
  type RowActions,
  SERVER_PILL_CLASS,
} from "@/components/session-row";
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
import type { ServerHint } from "@/lib/server-hint";
import { terminalLinkHref } from "@/lib/terminal-links";
import { cn } from "@/lib/utils";

/** VIEW-9, ACT-8. */
export function TerminalBar({
  row,
  environmentName,
  hint,
  actions,
}: {
  row: HubRow;
  environmentName: string | null;
  hint: ServerHint | undefined;
  actions: RowActions;
}) {
  const { terminal } = row;
  const running = isRunning(terminal);
  const title = terminal.title || "Terminal";
  const href = hint ? terminalLinkHref(hint.url) : undefined;
  return (
    <section
      aria-label="Terminal"
      className="flex h-9 shrink-0 items-center gap-2 border-b border-foreground/5 bg-background pl-4 pr-2 pointer-coarse:h-11"
    >
      <h2 className="min-w-0 truncate text-[13px] font-medium" title={title}>
        {title}
      </h2>
      {environmentName ? (
        <>
          <span aria-hidden="true" className="text-muted-foreground/60">
            ·
          </span>
          <span className="flex min-w-0 shrink items-center gap-1 font-mono text-[11.5px] text-muted-foreground">
            <Icon name="GitBranch" className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{environmentName}</span>
          </span>
        </>
      ) : null}
      {!running ? (
        <span className={cn(PILL_CLASS, exitPillClass(terminal.exitCode))}>
          {exitLabel(terminal.exitCode)}
        </span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        {hint && href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${href} (read from recent output)`}
            aria-label={`Open ${hint.label} in a new tab (address read from recent output)`}
            className={cn(
              PILL_CLASS,
              SERVER_PILL_CLASS,
              "flex items-center gap-1 transition-colors duration-150 hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none pointer-coarse:leading-8",
            )}
          >
            {hint.label}
            <Icon name="ExternalLink" className="size-3" aria-hidden="true" />
          </a>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className={ACTION_BUTTON_CLASS}
          aria-label="Restart shell"
          onClick={() => actions.onRestart(row)}
        >
          <Icon name="RotateCcw" aria-hidden="true" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={ACTION_BUTTON_CLASS}
              aria-label={`More actions for ${title}`}
            >
              <Icon name="MoreHorizontal" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => actions.onRename(row)}>Rename</DropdownMenuItem>
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
    </section>
  );
}
