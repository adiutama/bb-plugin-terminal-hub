// The confirmation and rename dialogs the row menu and bulk cleanup open.
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDialog({
  open,
  initialTitle,
  onRename,
  onCancel,
}: {
  open: boolean;
  initialTitle: string;
  onRename: (title: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  useEffect(() => {
    if (open) setTitle(initialTitle);
  }, [open, initialTitle]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (title.trim() !== "") onRename(title.trim());
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename terminal</DialogTitle>
            <DialogDescription>
              The new title shows everywhere this terminal appears.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Terminal title"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={title.trim() === ""}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
