// The Terminals page: pickers and the session list on the left, the selected
// terminal on the right. The selection lives in the URL (NAV-2).
import {
  type PluginNavPanelProps,
  useBbContext,
  useBbNavigate,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ConfirmDialog, RenameDialog } from "@/components/dialogs";
import { SessionList } from "@/components/session-list";
import type { RowActions } from "@/components/session-row";
import { TerminalView } from "@/components/terminal-view";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { nextSelection, renameTerminal, restartTerminal, settledTargets } from "@/lib/actions";
import { type HubSdk, HubStore, setActiveHubStore } from "@/lib/hub-store";
import type { HubRow, TerminalSession } from "@/lib/inventory";
import { ALL, formatRoute, PANEL_PATH, parseRoute, type Route } from "@/lib/route";

/** A new hub terminal's size until the view fits it to the page. */
const NEW_TERMINAL_SIZE = { cols: 120, rows: 32 };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** bb reports a terminal that does not exist as a not-found error. */
export function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { status?: unknown; code?: unknown; message?: unknown };
  if (record.status === 404) return true;
  const text = `${String(record.code ?? "")} ${String(record.message ?? "")}`;
  return /not[\s_-]?found/i.test(text);
}

type Missing =
  | { kind: "gone"; terminalId: string; exitCode: number | null }
  | { kind: "unreachable"; terminalId: string; message: string };

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function TerminalsPage({ subPath }: PluginNavPanelProps) {
  const sdk: HubSdk = useSdk();
  const context = useBbContext();
  const navigate = useBbNavigate();
  const store = useMemo(() => new HubStore(sdk), [sdk]);
  const view = useSyncExternalStore(store.subscribe, store.getView);
  const route = parseRoute(subPath);
  const now = useNow(30_000);

  useEffect(() => {
    setActiveHubStore(store);
    store.start();
    return () => store.dispose();
  }, [store]);

  const go = useCallback(
    (next: Route, replace: boolean) => {
      navigate.toPluginPanel(PANEL_PATH, { subPath: formatRoute(next), replace });
    },
    [navigate],
  );

  // NAV-4, NAV-7: fill in a missing project or environment, replacing the entry.
  const fallbackProject = context.projectId ?? view.projects?.[0]?.id ?? null;
  useEffect(() => {
    const projectId = route.projectId ?? fallbackProject;
    if (projectId === null) return;
    const canonical = formatRoute({ ...route, projectId });
    if (canonical !== subPath) go({ ...route, projectId }, true);
  }, [route, fallbackProject, subPath, go]);

  useEffect(() => {
    store.select(route.projectId, route.environment);
  }, [store, route.projectId, route.environment]);

  // Created or restarted here: the view answers its startup queries.
  const fresh = useRef(new Set<string>());
  const [lookups, setLookups] = useState<Map<string, TerminalSession>>(new Map());
  const [missing, setMissing] = useState<Missing | null>(null);
  const [lookupNonce, setLookupNonce] = useState(0);

  const selectedId = route.terminalId;
  const selectedRow = view.rows.find((row) => row.terminal.id === selectedId) ?? null;
  const selectedSession = selectedRow?.terminal ?? (selectedId ? lookups.get(selectedId) : null);
  const listed = view.sections.length > 0 && view.sections.every((section) => section.loaded);

  // NAV-5: a linked terminal that is not listed. Only a confirmed absence
  // (not found, or exited) counts as gone; a failed request keeps the link.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lookupNonce re-runs a retry.
  useEffect(() => {
    if (!selectedId || selectedRow || !listed || lookups.has(selectedId)) return;
    let cancelled = false;
    sdk.terminals.get({ terminalId: selectedId }).then(
      (session) => {
        if (cancelled) return;
        if (session.status === "exited") {
          setMissing({ kind: "gone", terminalId: selectedId, exitCode: session.exitCode });
          go({ ...route, terminalId: null }, true);
        } else {
          setLookups((current) => new Map(current).set(session.id, session));
        }
      },
      (error: unknown) => {
        if (cancelled) return;
        if (isNotFound(error)) {
          setMissing({ kind: "gone", terminalId: selectedId, exitCode: null });
          go({ ...route, terminalId: null }, true);
        } else {
          setMissing({ kind: "unreachable", terminalId: selectedId, message: message(error) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedRow, listed, lookups, sdk, lookupNonce]);

  useEffect(() => {
    if (missing?.kind === "unreachable" && missing.terminalId !== selectedId) setMissing(null);
  }, [missing, selectedId]);

  const select = (terminalId: string | null, replace = false) => {
    setMissing(null);
    go({ ...route, terminalId }, replace);
  };

  // ── actions ───────────────────────────────────────────────────────────

  const [renaming, setRenaming] = useState<HubRow | null>(null);
  const [closing, setClosing] = useState<HubRow | null>(null);
  const [bulk, setBulk] = useState<HubRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  const order = view.rows.map((row) => row.terminal.id);

  const doClose = async (row: HubRow) => {
    setBusy(true);
    try {
      await store.close(row.terminal.id);
      // ACT-7: the next terminal in the list, or the empty state.
      if (row.terminal.id === selectedId) select(nextSelection(order, row.terminal.id), true);
    } catch (error) {
      toast.error(`Could not close ${row.terminal.title || "the terminal"}: ${message(error)}`);
    } finally {
      setBusy(false);
      setClosing(null);
    }
  };

  const actions: RowActions = {
    onSelect: (row) => {
      if (row.terminal.id !== selectedId) select(row.terminal.id);
    },
    onRename: setRenaming,
    onRestart: async (row) => {
      try {
        const session = await restartTerminal(sdk, row.terminal.id);
        fresh.current.add(session.id);
        store.replace(row.terminal.id, session);
        if (row.terminal.id === selectedId || session.id !== row.terminal.id) {
          select(session.id, row.terminal.id === selectedId);
        }
      } catch (error) {
        toast.error(`Could not restart ${row.terminal.title || "the terminal"}: ${message(error)}`);
      }
    },
    // ACT-4: thread terminals ask first; environment terminals are the hub's.
    onClose: (row) => (row.terminal.threadId !== null ? setClosing(row) : void doClose(row)),
    onDismiss: (row) => {
      store.dismiss(row.terminal.id);
      if (row.terminal.id === selectedId) select(nextSelection(order, row.terminal.id), true);
    },
  };

  // LIST-9: an interactive shell at environment scope, selected.
  const newTerminal = async (environmentId: string) => {
    setCreating(environmentId);
    try {
      const session = await sdk.terminals.create({
        ...NEW_TERMINAL_SIZE,
        scope: { kind: "environment", environmentId },
        start: { mode: "shell" },
      });
      fresh.current.add(session.id);
      store.upsert(session);
      select(session.id);
    } catch (error) {
      toast.error(`Could not start a terminal: ${message(error)}`);
    } finally {
      setCreating(null);
    }
  };

  const settled = settledTargets(view.rows);

  const runBulk = async () => {
    if (!bulk) return;
    setBusy(true);
    try {
      const result = await store.closeAll(bulk);
      if (selectedId && result.closed.includes(selectedId)) {
        const remaining = order.filter((id) => id === selectedId || !result.closed.includes(id));
        select(nextSelection(remaining, selectedId), true);
      }
      if (result.failed.length > 0) {
        toast.error(
          `Could not close ${result.failed.length} of ${bulk.length}: ${result.failed
            .map((failure) => failure.row.terminal.title || failure.row.terminal.id)
            .join(", ")}`,
        );
      } else {
        toast.success(
          `Closed ${result.closed.length} terminal${result.closed.length === 1 ? "" : "s"}`,
        );
      }
    } finally {
      setBusy(false);
      setBulk(null);
    }
  };

  // ── layout ────────────────────────────────────────────────────────────

  const environmentOptions = view.environments ?? [];
  return (
    <div className="flex h-full min-h-0 flex-1">
      <aside className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="flex flex-col gap-2 border-b border-border p-2">
          <Select
            value={route.projectId ?? ""}
            onValueChange={(projectId) =>
              go({ projectId, environment: ALL, terminalId: null }, true)
            }
          >
            <SelectTrigger aria-label="Project">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              {(view.projects ?? []).map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={route.environment}
            onValueChange={(environment) => go({ ...route, environment, terminalId: null }, true)}
          >
            <SelectTrigger aria-label="Environment">
              <SelectValue placeholder="Environment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All environments</SelectItem>
              <SelectSeparator />
              {environmentOptions.map((env) => (
                <SelectItem key={env.id} value={env.id}>
                  {env.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {missing?.kind === "gone" ? (
            <div
              role="status"
              className="m-1 flex items-start gap-2 rounded-md border border-border bg-card p-2 text-xs"
            >
              <span className="flex-1">
                That terminal is gone
                {missing.exitCode === null ? "" : ` (it exited with code ${missing.exitCode})`}.
              </span>
              <button
                type="button"
                aria-label="Dismiss notice"
                className="text-muted-foreground"
                onClick={() => setMissing(null)}
              >
                <Icon name="X" className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {view.error ? (
            <p role="alert" className="m-1 text-xs text-destructive">
              {view.error}
            </p>
          ) : null}
          <SessionList
            view={view}
            selectedId={selectedId}
            now={now}
            actions={actions}
            creating={creating}
            onNewTerminal={(environmentId) => void newTerminal(environmentId)}
            onSelectEnvironment={(environment) =>
              go({ ...route, environment, terminalId: null }, true)
            }
          />
        </div>
        {settled.length > 0 ? (
          <div className="border-t border-border p-2">
            <Button variant="outline" size="sm" className="w-full" onClick={() => setBulk(settled)}>
              Close all from settled threads ({settled.length})
            </Button>
          </div>
        ) : null}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {selectedSession && selectedId ? (
          <TerminalView
            key={selectedId}
            sdk={sdk}
            terminalId={selectedId}
            cols={selectedSession.cols}
            rows={selectedSession.rows}
            fresh={fresh.current.has(selectedId)}
            onOutput={(id, bytes) => store.pushOutput(id, bytes)}
          />
        ) : missing?.kind === "unreachable" ? (
          <div className="m-auto flex max-w-sm flex-col items-center gap-3 text-center text-sm">
            <p role="alert" className="text-destructive">
              Could not reach this terminal: {missing.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMissing(null);
                setLookupNonce((n) => n + 1);
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
            {view.rows.length === 0
              ? "No terminals running here. Start one with New terminal."
              : "Select a terminal to see it here."}
          </div>
        )}
      </main>
      <RenameDialog
        open={renaming !== null}
        initialTitle={renaming?.terminal.title ?? ""}
        onCancel={() => setRenaming(null)}
        onRename={async (title) => {
          const row = renaming;
          setRenaming(null);
          if (!row) return;
          try {
            store.upsert(await renameTerminal(sdk, row.terminal.id, title));
          } catch (error) {
            toast.error(`Could not rename: ${message(error)}`);
          }
        }}
      />
      <ConfirmDialog
        open={closing !== null}
        title="Close this terminal?"
        description={
          closing ? (
            <>
              “{closing.terminal.title || "Terminal"}” belongs to the thread “
              {closing.thread?.title ?? closing.terminal.threadId}”. Anything running in it stops.
            </>
          ) : null
        }
        confirmLabel="Close terminal"
        busy={busy}
        onCancel={() => setClosing(null)}
        onConfirm={() => closing && void doClose(closing)}
      />
      <ConfirmDialog
        open={bulk !== null}
        title="Close all from settled threads?"
        description="These terminals belong to threads that are no longer active. Anything running in them stops."
        confirmLabel={`Close ${bulk?.length ?? 0}`}
        busy={busy}
        onCancel={() => setBulk(null)}
        onConfirm={() => void runBulk()}
      >
        <ul className="max-h-60 overflow-y-auto rounded-md border border-border text-sm">
          {(bulk ?? []).map((row) => (
            <li
              key={row.terminal.id}
              className="border-b border-border px-3 py-1.5 last:border-b-0"
            >
              <span className="font-medium">{row.terminal.title || "Terminal"}</span>
              <span className="text-muted-foreground"> · “{row.thread?.title}”</span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
