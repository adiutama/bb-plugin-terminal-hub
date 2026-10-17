// The Terminals page: the rail of environments on the left; the selected
// environment's terminals as tabs on the right, under them the bar and the
// selected terminal. The selection lives in the URL (NAV-2).
import {
  type PluginNavPanelProps,
  useBbContext,
  useBbNavigate,
  useRealtimeConnectionState,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ConfirmDialog, RenameDialog } from "@/components/dialogs";
import { EmptyPane, NewTerminalMenu } from "@/components/empty-pane";
import { EnvironmentRail } from "@/components/environment-rail";
import { type BarActions, TerminalBar } from "@/components/terminal-bar";
import { TerminalTabs } from "@/components/terminal-tabs";
import { TerminalView } from "@/components/terminal-view";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { endedHere, nextSelection, renameTerminal, restartTerminal } from "@/lib/actions";
import { isNotFound } from "@/lib/errors";
import { type HubSnapshot, hubFor } from "@/lib/hub";
import { type HubSdk, message } from "@/lib/hub-store";
import { type HubRow, isRunning, type TerminalSession } from "@/lib/inventory";
import { isFindShortcut, type PageShortcut, pageShortcut } from "@/lib/keyboard";
import { pageMemoryFor } from "@/lib/page-memory";
import { folderLabel } from "@/lib/paths";
import {
  chooseEnvironment,
  nextEnvironment,
  type Place,
  projectOf,
  railGroups,
  railOrder,
} from "@/lib/rail";
import { formatRoute, PANEL_PATH, parseRoute, type Route } from "@/lib/route";

/** A new hub terminal's size until the view fits it to the page. */
const NEW_TERMINAL_SIZE = { cols: 120, rows: 32 };

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

/** VIEW-9: a thread's title, fetched once per thread until bb reloads. */
const threadTitleCache = new WeakMap<object, Map<string, Promise<string | null>>>();
function useThreadTitle(sdk: HubSdk, threadId: string | null): string | null {
  const [titles, setTitles] = useState<ReadonlyMap<string, string | null>>(new Map());
  useEffect(() => {
    if (threadId === null || titles.has(threadId)) return;
    let threadTitles = threadTitleCache.get(sdk);
    if (!threadTitles) {
      threadTitles = new Map();
      threadTitleCache.set(sdk, threadTitles);
    }
    let request = threadTitles.get(threadId);
    if (!request) {
      request = sdk.threads.get({ threadId }).then(
        (thread) => thread.title ?? thread.titleFallback ?? "Untitled thread",
        () => null,
      );
      threadTitles.set(threadId, request);
    }
    let cancelled = false;
    void request.then((title) => {
      if (!cancelled) setTitles((current) => new Map(current).set(threadId, title));
    });
    return () => {
      cancelled = true;
    };
  }, [sdk, threadId, titles]);
  return threadId === null ? null : (titles.get(threadId) ?? null);
}

/** NAV-4: the environment of the thread bb was showing; undefined while it is fetched. */
function useContextEnvironment(
  sdk: HubSdk,
  threadId: string | null,
  wanted: boolean,
): string | null | undefined {
  const [found, setFound] = useState<{ threadId: string; environmentId: string | null } | null>(
    null,
  );
  useEffect(() => {
    if (!wanted || threadId === null || found?.threadId === threadId) return;
    let cancelled = false;
    sdk.threads.get({ threadId }).then(
      (thread) => !cancelled && setFound({ threadId, environmentId: thread.environmentId }),
      () => !cancelled && setFound({ threadId, environmentId: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [sdk, threadId, wanted, found]);
  if (threadId === null) return null;
  return found?.threadId === threadId ? found.environmentId : undefined;
}

/** LIST-36: the tab an environment last showed, if it still has it, else its first. */
function tabFor(
  snapshot: HubSnapshot,
  remembered: ReadonlyMap<string, string>,
  place: Place,
): string | null {
  const section = snapshot.views
    .get(place.projectId)
    ?.sections.find((s) => s.environment.id === place.environmentId);
  const rows = section?.rows ?? [];
  const last = remembered.get(place.environmentId);
  if (last && rows.some((row) => row.terminal.id === last)) return last;
  return rows[0]?.terminal.id ?? null;
}

export function TerminalsPage({ subPath }: PluginNavPanelProps) {
  const sdk: HubSdk = useSdk();
  const context = useBbContext();
  const navigate = useBbNavigate();
  const route = parseRoute(subPath);
  const memory = pageMemoryFor(sdk);
  const hub = hubFor(sdk);
  const snapshot = useSyncExternalStore(hub.subscribe, hub.getSnapshot);
  const now = useNow(30_000);

  // LIST-8, LIST-27: attaching starts every project's store, and on a return
  // checks the selection first (LIST-28); later route changes go through select.
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(() => hub.attach(routeRef.current), [hub]);
  useEffect(() => {
    hub.select({
      projectId: route.projectId,
      environmentId: route.environmentId,
      terminalId: route.terminalId,
    });
  }, [hub, route.projectId, route.environmentId, route.terminalId]);
  // LIST-27: while bb's realtime connection is down, the lists are last known.
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    hub.setConnection(connection);
  }, [hub, connection]);

  const go = useCallback(
    (next: Route, replace: boolean) => {
      navigate.toPluginPanel(PANEL_PATH, { subPath: formatRoute(next), replace });
    },
    [navigate],
  );
  // NAV-8: selections the page makes on its own replace the entry; asked
  // once, so a render before the router follows does not ask again.
  const requested = useRef<string | null>(null);
  if (requested.current === subPath) requested.current = null;
  const goAuto = (next: Route) => {
    const target = formatRoute(next);
    if (target === subPath || requested.current === target) return;
    requested.current = target;
    go(next, true);
  };
  const placeRoute = (place: Place): Route => ({
    ...place,
    terminalId: tabFor(snapshot, memory.tabs, place),
  });

  // ── the selection ─────────────────────────────────────────────────────

  const view = route.projectId ? snapshot.views.get(route.projectId) : undefined;
  const section =
    route.environmentId === null
      ? undefined
      : view?.sections.find((s) => s.environment.id === route.environmentId);
  const listedRows = section?.rows ?? [];
  const selectedId = route.terminalId;
  const selectedRow = listedRows.find((row) => row.terminal.id === selectedId) ?? null;

  // Created or restarted here: the view answers its startup queries.
  const fresh = useRef(new Set<string>());
  const [lookups, setLookups] = useState<Map<string, TerminalSession>>(new Map());
  const [missing, setMissing] = useState<Missing | null>(null);
  const [lookupNonce, setLookupNonce] = useState(0);
  const lookedUp = selectedId && !selectedRow ? (lookups.get(selectedId) ?? null) : null;
  const selectedSession = selectedRow?.terminal ?? lookedUp;
  // NAV-5: a linked terminal the lists do not hold still gets its tab.
  const tabs: HubRow[] = lookedUp
    ? [...listedRows, { terminal: lookedUp, thread: null, stale: false }]
    : listedRows;
  const tabIds = tabs.map((row) => row.terminal.id);

  const held: Place | null =
    route.projectId && route.environmentId && selectedSession
      ? { projectId: route.projectId, environmentId: route.environmentId }
      : null;
  const groups = railGroups(snapshot, held);
  const order = railOrder(groups);
  const listed = (environmentId: string | null) =>
    environmentId !== null && order.some((place) => place.environmentId === environmentId);

  // Normalize the URL (an old `all` link, or an environment under another
  // project, say), replacing the entry.
  useEffect(() => {
    const owner = route.environmentId ? projectOf(snapshot, route.environmentId) : null;
    if (owner !== null && owner !== route.projectId) goAuto({ ...route, projectId: owner });
    else if (formatRoute(route) !== subPath) goAuto(route);
  });

  // NAV-4: with no environment in the URL, the thread's environment, the one
  // last shown, or the first listed; waiting until the rail can tell.
  const contextEnvironment = useContextEnvironment(
    sdk,
    context.threadId,
    route.environmentId === null,
  );
  useEffect(() => {
    if (route.environmentId !== null || contextEnvironment === undefined) return;
    const choice = chooseEnvironment(snapshot, groups, [
      contextEnvironment,
      memory.lastEnvironment,
    ]);
    if (choice.kind === "place") goAuto(placeRoute(choice));
  });

  // LIST-36: an environment without a selected terminal shows its remembered tab.
  useEffect(() => {
    if (!route.projectId || !route.environmentId || selectedId !== null) return;
    const terminalId = tabFor(snapshot, memory.tabs, {
      projectId: route.projectId,
      environmentId: route.environmentId,
    });
    if (terminalId !== null) goAuto({ ...route, terminalId });
  });

  // LIST-37: the selected environment left the rail: the next one below it,
  // else above. One the rail never listed (a stale link) is handled as NAV-4.
  // The rail as it was while it last listed the selected environment.
  const railBefore = useRef(order);
  useEffect(() => {
    const environmentId = route.environmentId;
    if (environmentId === null || listed(environmentId)) {
      railBefore.current = order;
      return;
    }
    // The selected terminal is still being looked up or moved on from.
    if (selectedId !== null) return;
    const before = railBefore.current;
    if (before.some((place) => place.environmentId === environmentId)) {
      const next = nextEnvironment(before, order, environmentId);
      goAuto(
        next
          ? placeRoute(next)
          : { projectId: route.projectId, environmentId: null, terminalId: null },
      );
    } else if (view?.ready && !view.lastKnown) {
      goAuto({ projectId: route.projectId, environmentId: null, terminalId: null });
    }
  });

  // NAV-4, LIST-36: remember the environment and its tab until bb reloads.
  useEffect(() => {
    if (!route.environmentId || !listed(route.environmentId)) return;
    memory.lastEnvironment = route.environmentId;
    if (selectedId && tabIds.includes(selectedId)) memory.tabs.set(route.environmentId, selectedId);
  });

  // ACT-7: after the selected terminal goes, the tab to its right, else left.
  const moveOn = (closedId: string, ids: readonly string[]) => {
    setMissing(null);
    go({ ...route, terminalId: nextSelection(ids, closedId) }, true);
  };

  // NAV-5: a linked terminal that is not listed. Only a confirmed absence
  // (not found, or exited) counts as gone; a failed request keeps the link.
  const tabsBefore = useRef(tabIds);
  const vanished = selectedId !== null && (view?.vanished.has(selectedId) ?? false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: lookupNonce re-runs a retry.
  useEffect(() => {
    const before = tabsBefore.current;
    if (!selectedId || selectedRow || !route.projectId) return;
    const store = hub.storeFor(route.projectId);
    // Closed or dismissed here: the action moves the selection itself (ACT-7).
    if (store.removedHere(selectedId)) return;
    // LIST-28: a listed terminal bb no longer has, found on return or later.
    if (vanished) {
      setMissing({ kind: "gone", terminalId: selectedId, exitCode: null });
      go({ ...route, terminalId: nextSelection(before, selectedId) }, true);
      return;
    }
    if (!view?.complete || lookups.has(selectedId)) return;
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
  }, [selectedId, selectedRow, view?.complete, vanished, lookups, sdk, hub, lookupNonce]);
  useEffect(() => {
    if (selectedId && tabIds.includes(selectedId)) tabsBefore.current = tabIds;
  });

  useEffect(() => {
    if (missing?.kind === "unreachable" && missing.terminalId !== selectedId) setMissing(null);
  }, [missing, selectedId]);

  // A fresh shell's startup queries are answered on its first view only (VIEW-5).
  useEffect(() => {
    if (selectedId && selectedSession) fresh.current.delete(selectedId);
  }, [selectedId, selectedSession]);

  // ── the rail ──────────────────────────────────────────────────────────

  const [find, setFindState] = useState(memory.find);
  const setFind = (text: string) => {
    setFindState(text);
    memory.find = text;
  };
  const [folded, setFolded] = useState(memory.folded);
  const toggleProject = (projectId: string) => {
    const next = new Set(folded);
    if (!next.delete(projectId)) next.add(projectId);
    memory.folded = next;
    setFolded(next);
  };
  const findRef = useRef<HTMLInputElement>(null);

  const selectPlace = (place: Place) => {
    if (place.environmentId === route.environmentId) return;
    setMissing(null);
    go(placeRoute(place), false);
  };

  // ── actions ───────────────────────────────────────────────────────────

  const store = route.projectId ? hub.storeFor(route.projectId) : null;
  const [renaming, setRenaming] = useState<HubRow | null>(null);
  const [closing, setClosing] = useState<{ row: HubRow; order: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const doClose = async (row: HubRow, ids: readonly string[]) => {
    if (!store) return;
    setBusy(true);
    try {
      await store.close(row.terminal.id);
      if (row.terminal.id === routeRef.current.terminalId) moveOn(row.terminal.id, ids);
    } catch (error) {
      toast.error(`Could not close ${row.terminal.title || "the terminal"}: ${message(error)}`);
    } finally {
      setBusy(false);
      setClosing(null);
    }
  };

  // LIST-40, LIST-41: an interactive shell at environment scope, selected.
  const newTerminal = async (place: Place) => {
    setCreating(true);
    try {
      const session = await sdk.terminals.create({
        ...NEW_TERMINAL_SIZE,
        scope: { kind: "environment", environmentId: place.environmentId },
        start: { mode: "shell" },
      });
      fresh.current.add(session.id);
      hub.storeFor(place.projectId).upsert(session);
      setMissing(null);
      go({ ...place, terminalId: session.id }, false);
    } catch (error) {
      toast.error(`Could not start a terminal: ${message(error)}`);
    } finally {
      setCreating(false);
    }
  };

  const actions: BarActions = {
    onRename: setRenaming,
    onRestart: async (row) => {
      try {
        const session = await restartTerminal(sdk, row.terminal.id);
        fresh.current.add(session.id);
        store?.replace(row.terminal.id, session);
        if (row.terminal.id === selectedId || session.id !== row.terminal.id) {
          go({ ...route, terminalId: session.id }, row.terminal.id === selectedId);
        }
      } catch (error) {
        toast.error(`Could not restart ${row.terminal.title || "the terminal"}: ${message(error)}`);
      }
    },
    // ACT-4: thread terminals ask first; environment terminals are the hub's.
    onClose: (row) =>
      row.terminal.threadId !== null
        ? setClosing({ row, order: tabIds })
        : void doClose(row, tabIds),
    onDismiss: (row) => {
      store?.dismiss(row.terminal.id);
      if (row.terminal.id === selectedId) moveOn(row.terminal.id, tabIds);
    },
    onOpenThread: (threadId) => navigate.toThread(threadId),
  };

  // LIST-46: a tab's ×, and Mod+W on the selected tab: close a running
  // terminal (ACT-4, ACT-6), dismiss an ended one (LIST-11).
  const closeTab = (row: HubRow) =>
    isRunning(row.terminal) ? actions.onClose(row) : actions.onDismiss(row);

  // LIST-47: Mod+T, Mod+W and Mod+P, taken in the capture phase on window so
  // the page handles them before bb's shortcuts and the terminal view do.
  const rootRef = useRef<HTMLDivElement>(null);
  const shortcuts = useRef<(key: PageShortcut) => void>(() => {});
  shortcuts.current = (key) => {
    if (key === "find") {
      findRef.current?.focus();
      findRef.current?.select();
    } else if (key === "close") {
      if (barRow) closeTab(barRow);
    } else if (route.projectId && route.environmentId && !creating) {
      void newTerminal({ projectId: route.projectId, environmentId: route.environmentId });
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = pageShortcut(event, rootRef.current);
      if (key === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      shortcuts.current(key);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  // ── layout ────────────────────────────────────────────────────────────

  const projectName = snapshot.projects?.find((p) => p.id === route.projectId)?.name ?? null;
  const environment = section?.environment ?? null;
  const barRow: HubRow | null =
    selectedRow ?? (lookedUp ? { terminal: lookedUp, thread: null, stale: false } : null);
  const spawnedBy = useThreadTitle(sdk, barRow?.thread?.parentThreadId ?? null);
  const home = barRow ? (view?.homes.get(barRow.terminal.hostId) ?? null) : null;
  const folder = barRow
    ? folderLabel(barRow.terminal.initialCwd, environment?.path ?? "", home)
    : "";
  const showsEnvironment = route.environmentId !== null && (section !== undefined || lookedUp);

  // LIST-25: the sentence for the state, and once complete a way to start a shell.
  const nothingRuns = order.length === 0 && snapshot.succeeded;
  const emptyMessage = nothingRuns
    ? "Nothing running."
    : order.length === 0 && snapshot.failed
      ? "Could not list every terminal yet; trying again shortly."
      : "Looking for terminals…";

  return (
    // LIST-44: `/` from anywhere in the page focuses the find field. The root
    // takes focus from clicks on blank space (tabIndex -1), so the page
    // counts as focused without making the root a Tab stop.
    // biome-ignore lint/a11y/noStaticElementInteractions: the handler acts on `/` only.
    <div
      ref={rootRef}
      tabIndex={-1}
      className="flex h-full min-h-0 flex-1 outline-none"
      onKeyDown={(event) => {
        if (!isFindShortcut(event)) return;
        event.preventDefault();
        event.stopPropagation();
        findRef.current?.focus();
        findRef.current?.select();
      }}
    >
      <EnvironmentRail
        snapshot={snapshot}
        groups={groups}
        selected={
          route.projectId && route.environmentId
            ? { projectId: route.projectId, environmentId: route.environmentId }
            : null
        }
        find={find}
        onFind={setFind}
        findRef={findRef}
        folded={folded}
        onToggleProject={toggleProject}
        onSelect={selectPlace}
        creating={creating}
        onCreate={(place) => void newTerminal(place)}
        memory={memory}
      />
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        {showsEnvironment && route.projectId && route.environmentId ? (
          <TerminalTabs
            rows={tabs}
            selectedId={selectedId}
            hints={view?.hints ?? new Map()}
            environmentName={environment?.name ?? route.environmentId}
            creating={creating}
            onClose={closeTab}
            onSelect={(terminalId) => {
              setMissing(null);
              go({ ...route, terminalId }, false);
            }}
            onCreate={() =>
              route.projectId &&
              route.environmentId &&
              void newTerminal({ projectId: route.projectId, environmentId: route.environmentId })
            }
          />
        ) : null}
        {missing?.kind === "gone" ? (
          <div
            role="status"
            className="flex shrink-0 items-center gap-2 border-b border-foreground/8 px-4 py-1.5 text-[12.5px] text-muted-foreground"
          >
            <span className="flex-1">
              That terminal is gone
              {missing.exitCode === null ? "" : ` (it exited with code ${missing.exitCode})`}.
            </span>
            <button
              type="button"
              aria-label="Dismiss notice"
              className="grid size-6 place-items-center rounded-md hover:bg-foreground/6"
              onClick={() => setMissing(null)}
            >
              <Icon name="X" className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {selectedSession && selectedId && barRow ? (
          <>
            <TerminalBar
              row={barRow}
              place={projectName && environment ? `${projectName}/${environment.name}` : null}
              folder={folder}
              hint={view?.hints.get(selectedId)}
              spawnedBy={spawnedBy}
              now={now}
              actions={actions}
            />
            {/* VIEW-10: the inset lies outside the element the view measures. */}
            <div data-terminal-inset="" className="flex min-h-0 min-w-0 flex-1 px-4 py-3.5">
              <TerminalView
                key={selectedId}
                sdk={sdk}
                terminalId={selectedId}
                cols={selectedSession.cols}
                rows={selectedSession.rows}
                fresh={fresh.current.has(selectedId)}
                onOutput={(id, bytes) => store?.pushOutput(id, bytes)}
                onExit={(id, status, exitCode, typedAgoMs) => {
                  // LIST-32: ended by the user's own typing here: gone, like a
                  // dismissed tab, and the selection moves on (ACT-7).
                  if (endedHere(typedAgoMs)) {
                    store?.dismiss(id);
                    if (id === routeRef.current.terminalId) moveOn(id, tabIds);
                  } else store?.noteEnded(id, status, exitCode);
                }}
              />
            </div>
          </>
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
        ) : showsEnvironment ? null : (
          // LIST-25: the sentence for the state.
          <EmptyPane message={emptyMessage}>
            {nothingRuns ? (
              <NewTerminalMenu
                snapshot={snapshot}
                creating={creating}
                onCreate={(place) => void newTerminal(place)}
              />
            ) : null}
          </EmptyPane>
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
            const session = await renameTerminal(sdk, row.terminal.id, title);
            store?.upsert(session);
            // A linked terminal the lists do not hold (NAV-5) shows from here.
            setLookups((current) =>
              current.has(session.id) ? new Map(current).set(session.id, session) : current,
            );
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
              “{closing.row.terminal.title || "Terminal"}” belongs to the thread “
              {closing.row.thread?.title ?? closing.row.terminal.threadId}”. Anything running in it
              stops.
            </>
          ) : null
        }
        confirmLabel="Close terminal"
        busy={busy}
        onCancel={() => setClosing(null)}
        onConfirm={() => closing && void doClose(closing.row, closing.order)}
      />
    </div>
  );
}
