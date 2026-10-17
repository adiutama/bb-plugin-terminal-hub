// The selected environment's terminals as tabs, each with its ×, and the `+`
// that starts a shell there (LIST-12, LIST-38 to LIST-40, LIST-46).
import { type KeyboardEvent, useEffect, useRef } from "react";
import { BAND_CLASS, SIDEBAR_TONE_CLASS } from "@/components/environment-rail";
import { Icon } from "@/components/ui/icon";
import { type HubRow, isRunning } from "@/lib/inventory";
import type { ServerHint } from "@/lib/server-hint";
import { cn } from "@/lib/utils";

/** "exit 1", or "exited" when bb gave no code. */
export function exitLabel(exitCode: number | null): string {
  return exitCode === null ? "exited" : `exit ${exitCode}`;
}

export function TerminalTabs({
  rows,
  selectedId,
  hints,
  environmentName,
  creating,
  onSelect,
  onClose,
  onCreate,
}: {
  rows: readonly HubRow[];
  selectedId: string | null;
  hints: ReadonlyMap<string, ServerHint>;
  environmentName: string;
  creating: boolean;
  onSelect: (terminalId: string) => void;
  /** LIST-46: close a running terminal, dismiss an ended one. */
  onClose: (row: HubRow) => void;
  onCreate: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const tabFor = (terminalId: string) =>
    Array.from(stripRef.current?.querySelectorAll<HTMLElement>("[data-terminal-id]") ?? []).find(
      (tab) => tab.dataset.terminalId === terminalId,
    );

  // LIST-39: the selected tab stays in view when the strip scrolls sideways.
  useEffect(() => {
    if (selectedId === null) return;
    tabFor(selectedId)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  });

  // LIST-39: ← and → select the previous and next tab, Home and End the ends.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = rows.findIndex((row) => row.terminal.id === selectedId);
    let next: HubRow | undefined;
    if (event.key === "ArrowRight") next = rows[Math.min(index + 1, rows.length - 1)];
    else if (event.key === "ArrowLeft") next = rows[Math.max(index - 1, 0)];
    else if (event.key === "Home") next = rows[0];
    else if (event.key === "End") next = rows.at(-1);
    else return;
    event.preventDefault();
    if (!next) return;
    tabFor(next.terminal.id)?.focus();
    if (next.terminal.id !== selectedId) onSelect(next.terminal.id);
  };

  return (
    <div className={cn(BAND_CLASS, "flex min-w-0 items-stretch", SIDEBAR_TONE_CLASS)}>
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Terminals"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex min-w-0 items-stretch overflow-x-auto outline-none [scrollbar-width:none]"
      >
        {rows.map((row) => {
          const { terminal } = row;
          const selected = terminal.id === selectedId;
          const running = isRunning(terminal);
          const hint = running ? hints.get(terminal.id) : undefined;
          const title = terminal.title || "Terminal";
          return (
            <div
              key={terminal.id}
              role="presentation"
              className={cn(
                "group relative flex max-w-64 shrink-0 items-center border-r border-foreground/6",
                selected
                  ? "bg-background text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-background"
                  : "text-muted-foreground hover:text-foreground",
                !running && "text-muted-foreground/60",
              )}
            >
              <button
                type="button"
                role="tab"
                id={`terminal-tab-${terminal.id}`}
                data-terminal-id={terminal.id}
                aria-selected={selected}
                tabIndex={selected || (selectedId === null && row === rows[0]) ? 0 : -1}
                title={title}
                onClick={() => {
                  if (!selected) onSelect(terminal.id);
                }}
                className="flex h-full min-w-0 items-center gap-2 whitespace-nowrap py-0 pl-3.5 pr-1 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate">{title}</span>
                {!running ? (
                  <span data-tab-exit="" className="font-mono text-[11.5px]">
                    {exitLabel(terminal.exitCode)}
                  </span>
                ) : hint ? (
                  <span data-tab-hint="" className="font-mono text-[11.5px] text-muted-foreground">
                    {hint.label}
                  </span>
                ) : null}
              </button>
              {/* LIST-46: hidden by opacity only, so showing it moves nothing. */}
              <button
                type="button"
                tabIndex={-1}
                aria-label={`${running ? "Close" : "Dismiss"} ${title}`}
                title={running ? "Close" : "Dismiss"}
                data-tab-close=""
                onClick={() => onClose(row)}
                className={cn(
                  "mr-1.5 grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-opacity duration-150 hover:bg-foreground/8 hover:text-foreground motion-reduce:transition-none pointer-coarse:size-8 pointer-coarse:opacity-100",
                  selected
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                )}
              >
                <Icon name="X" className="size-3" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label={`New terminal in ${environmentName}`}
        title={`New terminal in ${environmentName}`}
        disabled={creating}
        onClick={onCreate}
        className="grid w-10 shrink-0 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
      >
        <Icon name="Plus" className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
