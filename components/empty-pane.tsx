// LIST-25: the main pane with nothing to show.
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

export function EmptyPane({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center text-[13px] text-muted-foreground">
      <span className="grid size-11 place-items-center rounded-xl bg-foreground/[0.04] text-foreground/80">
        <Icon name="Terminal" className="size-5" aria-hidden="true" />
      </span>
      <p className="text-foreground/90">{message}</p>
      {children}
    </div>
  );
}
