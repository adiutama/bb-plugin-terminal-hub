// Above the list: the New terminal split button, the filter, and the summary line.
import { type RefObject, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { menuEnvironments, type Summary } from "@/lib/all-view";
import type { EnvironmentInfo } from "@/lib/hub-store";
import { navItems } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

/**
 * LIST-9: the main part starts a shell in `targetId`, or opens the menu when
 * there is none; ▾ opens "New terminal in…" with the target first. The list
 * header shows it as a quiet row naming the target; the empty main pane
 * (LIST-25) as a solid button.
 */
export function NewTerminalButton({
  environments,
  targetId,
  creating,
  onCreate,
  appearance = "row",
}: {
  environments: readonly EnvironmentInfo[];
  targetId: string | null;
  creating: string | null;
  onCreate: (environmentId: string) => void;
  appearance?: "row" | "solid";
}) {
  const [open, setOpen] = useState(false);
  const { first, rest } = menuEnvironments(environments, targetId);
  const busy = creating !== null;
  const item = (env: EnvironmentInfo) => (
    <DropdownMenuItem key={env.id} title={env.path} onSelect={() => onCreate(env.id)}>
      <span className="truncate">{env.name}</span>
    </DropdownMenuItem>
  );
  const row = appearance === "row";
  return (
    <div className={cn("flex", row ? "rounded-lg" : "rounded-lg bg-foreground text-background")}>
      <Button
        variant={row ? "ghost" : "default"}
        className={cn(
          "min-w-0 justify-start gap-2.5 rounded-r-none",
          row
            ? "h-8 flex-1 rounded-l-lg px-2 text-[13.5px] pointer-coarse:h-9"
            : "h-8 rounded-l-lg px-3 text-[13px] font-semibold pointer-coarse:h-9",
        )}
        disabled={busy || environments.length === 0}
        onClick={() => (targetId === null ? setOpen(true) : onCreate(targetId))}
      >
        <Icon name="Plus" className="size-4" aria-hidden="true" />
        {busy ? "Starting…" : "New terminal"}
        {first && !busy ? (
          <span
            className={cn(
              "min-w-0 truncate font-mono text-[11.5px] font-normal",
              row ? "ml-auto text-muted-foreground" : "text-background/70",
            )}
          >
            in {first.name}
          </span>
        ) : null}
      </Button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant={row ? "ghost" : "default"}
            className={cn(
              "h-8 w-8 rounded-l-none rounded-r-lg px-0 pointer-coarse:h-9 pointer-coarse:w-9",
              row ? "text-muted-foreground" : "border-l border-background/20",
            )}
            disabled={busy || environments.length === 0}
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

/**
 * LIST-16: "N running · N servers", then "Clean up N stale", which opens
 * ACT-5's confirmation.
 */
export function SummaryLine({ summary, onStale }: { summary: Summary; onStale: () => void }) {
  return (
    <section
      aria-label="Summary"
      className="flex min-h-6 items-center gap-1.5 px-1 text-xs tabular-nums text-muted-foreground"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          summary.running > 0 ? "bg-emerald-500" : "bg-muted-foreground/50",
        )}
      />
      <span className={summary.running > 0 ? "text-foreground/80" : undefined}>
        {summary.running} running
      </span>
      {summary.servers > 0 ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{plural(summary.servers, "server")}</span>
        </>
      ) : null}
      {summary.stale > 0 ? (
        <button
          type="button"
          className="ml-auto flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-amber-700 transition-colors duration-150 hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none dark:text-amber-400 pointer-coarse:min-h-8"
          title="Close all terminals from settled threads"
          onClick={onStale}
        >
          <Icon name="Brush" fallback="Trash2" className="size-3" aria-hidden="true" />
          Clean up {summary.stale} stale
        </button>
      ) : null}
    </section>
  );
}

/**
 * LIST-18, LIST-22: the filter. Escape clears it, then leaves it for the
 * list; ↓ enters the list; Enter opens the first item shown.
 */
export function FilterBox({
  value,
  onChange,
  inputRef,
  listRef,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLElement | null>;
}) {
  return (
    <div className="relative flex items-center">
      <Icon
        name="Search"
        className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        value={value}
        placeholder="Filter terminals, environments, threads…"
        aria-label="Filter terminals"
        aria-keyshortcuts="/"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="h-8 rounded-lg border-transparent bg-foreground/[0.04] pl-7 pr-7 text-[13px] hover:border-border focus-visible:border-border pointer-coarse:h-9 pointer-coarse:pr-10"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          const items = navItems(listRef.current);
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (value !== "") onChange("");
            else {
              const current = items.find((item) => item.getAttribute("aria-current") === "true");
              const next = current ?? items[0];
              if (next) next.focus();
              else event.currentTarget.blur();
            }
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            items[0]?.focus();
          } else if (event.key === "Enter") {
            event.preventDefault();
            items[0]?.click();
          }
        }}
      />
      {value !== "" ? (
        <button
          type="button"
          aria-label="Clear filter"
          className="absolute right-1 grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground pointer-coarse:size-8"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <Icon name="X" className="size-3.5" aria-hidden="true" />
        </button>
      ) : (
        <span aria-hidden="true" className="pointer-events-none absolute right-2">
          <kbd className="rounded border border-border px-1 font-mono text-[10.5px] text-muted-foreground">
            /
          </kbd>
        </span>
      )}
    </div>
  );
}
