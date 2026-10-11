// LIST-25: the main pane with no terminal selected.
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="mr-1 rounded border border-border px-1 font-mono text-[10.5px] text-muted-foreground">
      {children}
    </kbd>
  );
}

export function EmptyPane({ message, action }: { message: string; action: ReactNode }) {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <span className="grid size-11 place-items-center rounded-xl bg-foreground/[0.04] text-foreground/80">
        <Icon name="Terminal" className="size-5" aria-hidden="true" />
      </span>
      <p className="text-foreground/90">{message}</p>
      {action}
      {/* Fine pointers only: with touch, there is no keyboard to hint at. */}
      <p
        data-key-hints=""
        className="hidden gap-3.5 text-[11.5px] text-muted-foreground/80 pointer-fine:flex"
      >
        <span>
          <Key>/</Key>filter
        </span>
        <span>
          <Key>↑</Key>
          <Key>↓</Key>move
        </span>
        <span>
          <Key>↵</Key>open
        </span>
      </p>
    </div>
  );
}
