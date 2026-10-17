// The bar above the selected terminal: what it is, where it runs, who owns
// it, and what can be done to it (VIEW-9, ACT-8). It sits outside the
// terminal view, so its keys never reach the shell.
import { exitLabel } from "@/components/terminal-tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { type HubRow, type HubThread, isRunning } from "@/lib/inventory";
import type { ServerHint } from "@/lib/server-hint";
import { terminalLinkHref } from "@/lib/terminal-links";
import { formatAgo } from "@/lib/time";

/** Bar icon buttons: 28px, 36px on a coarse pointer. */
const ACTION_BUTTON_CLASS =
  "size-7 shrink-0 rounded-md text-muted-foreground pointer-coarse:size-9 [&_[data-icon-root]]:size-3.5";

export interface BarActions {
  onRestart: (row: HubRow) => void;
  onRename: (row: HubRow) => void;
  onClose: (row: HubRow) => void;
  onDismiss: (row: HubRow) => void;
  onOpenThread: (threadId: string) => void;
  /** ACT-5: for the selected environment. */
  onCleanup: () => void;
}

/** VIEW-9: "idle 2h", "error 5m", "archived"; nothing while active. */
export function threadStateLabel(thread: HubThread, now: number): string | null {
  if (thread.state === "active") return null;
  if (thread.state === "archived") return "archived";
  const ago = thread.inactiveSince === null ? "" : ` ${formatAgo(thread.inactiveSince, now)}`;
  return `${thread.state}${ago}`;
}

/** A server address without its scheme or trailing slash. */
function addressLabel(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function TerminalBar({
  row,
  place,
  folder,
  hint,
  spawnedBy,
  now,
  cleanupCount,
  actions,
}: {
  row: HubRow;
  /** `project/environment`, when known. */
  place: string | null;
  /** The starting folder as VIEW-9 shows it; empty to leave it out. */
  folder: string;
  hint: ServerHint | undefined;
  /** The title of the thread that spawned the owning thread, if any. */
  spawnedBy: string | null;
  now: number;
  /** ACT-5: running thread terminals of settled threads in this environment. */
  cleanupCount: number;
  actions: BarActions;
}) {
  const { terminal, thread } = row;
  const running = isRunning(terminal);
  const title = terminal.title || "Terminal";
  const href = running && hint ? terminalLinkHref(hint.url) : undefined;
  const state = thread ? threadStateLabel(thread, now) : null;
  return (
    <section
      aria-label="Terminal"
      className="flex h-[52px] shrink-0 items-center gap-3 border-b border-foreground/8 bg-background pl-4 pr-2 pointer-coarse:h-14"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="min-w-0 truncate text-[13px] font-medium" title={title}>
            {title}
          </h2>
          {!running ? (
            <span data-bar-exit="" className="shrink-0 font-mono text-[12px] text-muted-foreground">
              {exitLabel(terminal.exitCode)}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
          {place ? (
            <span data-bar-place="" className="min-w-0 shrink truncate font-mono" title={place}>
              {place}
              {folder ? ` ${folder}` : ""}
            </span>
          ) : null}
          {thread ? (
            <span data-bar-thread="" className="flex min-w-0 shrink-[2] items-center gap-1">
              <span className="shrink-0">from</span>
              <button
                type="button"
                onClick={() => actions.onOpenThread(thread.id)}
                title={`Open ${thread.title}`}
                className="min-w-0 truncate rounded-sm text-foreground/80 underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
              >
                {thread.title}
              </button>
              {state ? <span className="shrink-0">{state}</span> : null}
            </span>
          ) : null}
          {spawnedBy ? (
            <span data-bar-parent="" className="min-w-0 truncate" title={`spawned by ${spawnedBy}`}>
              spawned by {spawnedBy}
            </span>
          ) : null}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-0.5">
        {hint && href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${href} (read from recent output)`}
            aria-label={`Open ${hint.label} in a new tab (address read from recent output)`}
            className="mr-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 font-mono text-[12px] text-foreground/90 transition-colors duration-150 hover:bg-foreground/6 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none"
          >
            {addressLabel(href)}
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
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => (running ? actions.onClose(row) : actions.onDismiss(row))}
            >
              {running ? "Close" : "Dismiss"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={cleanupCount === 0} onSelect={actions.onCleanup}>
              Close terminals from settled threads…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </section>
  );
}
