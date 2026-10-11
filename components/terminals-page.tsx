// The Terminals page: pickers and the session list on the left, the selected
// terminal on the right. The selection lives in the URL (NAV-2).
import {
  type PluginNavPanelProps,
  useBbContext,
  useBbNavigate,
  useRealtimeConnectionState,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { ConfirmDialog, RenameDialog } from "@/components/dialogs";
import { EmptyPane } from "@/components/empty-pane";
import { FilterBox, NewTerminalButton, SummaryLine } from "@/components/list-header";
import { SessionList } from "@/components/session-list";
import type { RowActions } from "@/components/session-row";
import { TerminalBar } from "@/components/terminal-bar";
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
import {
  environmentOf,
  filterAll,
  filteredOrder,
  filterSection,
  filterWords,
  splitSections,
  summarize,
  visibleOrder,
} from "@/lib/all-view";
import { isNotFound } from "@/lib/errors";
import { type HubSdk, type HubView, hubStoreFor, projectsFor, type Section } from "@/lib/hub-store";
import type { HubRow, TerminalSession } from "@/lib/inventory";
import { isFilterShortcut } from "@/lib/keyboard";
import {
  applyScrollAnchor,
  type PageMemory,
  pageMemoryFor,
  readScrollAnchor,
} from "@/lib/page-memory";
import { ALL, formatRoute, PANEL_PATH, parseRoute, type Route } from "@/lib/route";
import { cn } from "@/lib/utils";

/** LIST-26: the project and environment pickers, as borderless triggers. */
const SCOPE_TRIGGER =
  "h-7 w-auto min-w-0 shrink justify-start gap-1 rounded-md border-0 px-1.5 text-[13.5px] hover:bg-state-hover focus:ring-1 pointer-coarse:h-9 [&>span]:truncate [&_[data-icon-root]]:size-3.5 [&_[data-icon-root]]:text-muted-foreground";

/** A new hub terminal's size until the view fits it to the page. */
const NEW_TERMINAL_SIZE = { cols: 120, rows: 32 };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Missing =
  | { kind: "gone"; terminalId: string; exitCode: number | null }
  | { kind: "unreachable"; terminalId: string; message: string };

/** What the page shows before the route names a project. */
const NO_VIEW: HubView = {
  projectId: "",
  environment: ALL,
  environments: null,
  environmentsListed: false,
  sections: [],
  rows: [],
  running: 0,
  hints: new Map(),
  homes: new Map(),
  error: null,
  complete: false,
  lastKnown: false,
  freshness: "live",
  scan: null,
  vanished: new Set(),
};
const noView = () => NO_VIEW;
const noSubscription = () => () => {};

/**
 * LIST-29: remembers the list's scroll position per project by the row at
 * its top, and puts that row back where it was when the page opens again.
 */
function useRememberedScroll(
  scroller: RefObject<HTMLDivElement | null>,
  memory: PageMemory,
  projectId: string | null,
  rowIds: readonly string[],
) {
  // Restoring until the anchor is placed or cannot be; scroll events are not
  // recorded meanwhile, so the page's own first layout cannot overwrite it.
  const restore = useRef<{ projectId: string | null; done: boolean }>({
    projectId: null,
    done: true,
  });
  if (restore.current.projectId !== projectId) {
    restore.current = { projectId, done: projectId === null };
  }
  useLayoutEffect(() => {
    const element = scroller.current;
    const state = restore.current;
    if (!element || state.done || state.projectId === null) return;
    const anchor = memory.project(state.projectId).scroll;
    if (anchor !== null && applyScrollAnchor(element, anchor)) {
      state.done = true;
      return;
    }
    // Nothing remembered, or the anchor is not rendered. Wait for rows; once
    // the list has rows, the anchor is gone, filtered out, or collapsed. Either
    // way the list starts at the top, never where another project left it.
    if (anchor === null || rowIds.length > 0) {
      element.scrollTop = 0;
      state.done = true;
    }
  });
  useEffect(() => {
    const element = scroller.current;
    if (!element || projectId === null) return;
    let frame = 0;
    const record = () => {
      frame = 0;
      if (restore.current.done) memory.project(projectId).scroll = readScrollAnchor(element);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(record);
    };
    element.addEventListener("scroll", onScroll);
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
        if (element.isConnected) record();
      }
    };
  }, [scroller, memory, projectId]);
}

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
  const route = parseRoute(subPath);
  const memory = pageMemoryFor(sdk);
  const projectList = projectsFor(sdk);
  const { projects } = useSyncExternalStore(projectList.subscribe, projectList.get);
  // The store for the route's project, taken as the page renders, so one
  // project's rows never show under another's (ADR 202610111227).
  const store = route.projectId ? hubStoreFor(sdk, route.projectId) : null;
  const view = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    store ? () => store.viewFor(route.environment) : noView,
  );
  const now = useNow(30_000);

  useEffect(() => {
    void projectList.load();
  }, [projectList]);

  // LIST-27: attaching starts the refreshes, and on a return checks the
  // selection first (LIST-28); the route's later changes go through select.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attach reads the route once; the effect below follows it.
  useEffect(() => store?.attach(route.environment, route.terminalId), [store]);
  useEffect(() => {
    store?.select(route.environment, route.terminalId);
  }, [store, route.environment, route.terminalId]);
  // LIST-27: while bb's realtime connection is down, the rows are last known.
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    store?.setConnection(connection);
  }, [store, connection]);

  const go = useCallback(
    (next: Route, replace: boolean) => {
      navigate.toPluginPanel(PANEL_PATH, { subPath: formatRoute(next), replace });
    },
    [navigate],
  );

  // NAV-4, NAV-7, NAV-10: fill in a missing project or environment, replacing
  // the entry. Only the root route restores the project's remembered place:
  // the project the page last showed first, as the rail opens it at its root.
  const last = memory.lastProjectId;
  const lastListed =
    last !== null && (projects === null || projects.some((project) => project.id === last));
  const fallbackProject =
    (lastListed ? last : null) ?? context.projectId ?? projects?.[0]?.id ?? null;
  useEffect(() => {
    if (route.projectId === null) {
      if (fallbackProject === null) return;
      const remembered = memory.project(fallbackProject).route;
      go(
        {
          projectId: fallbackProject,
          environment: remembered?.environment ?? ALL,
          terminalId: remembered?.terminalId ?? null,
        },
        true,
      );
      return;
    }
    if (formatRoute(route) !== subPath) go(route, true);
  }, [route, fallbackProject, subPath, go, memory]);

  // NAV-10: remember where the user is in each project.
  useEffect(() => {
    if (route.projectId === null) return;
    memory.lastProjectId = route.projectId;
    memory.project(route.projectId).route = {
      environment: route.environment,
      terminalId: route.terminalId,
    };
  }, [memory, route.projectId, route.environment, route.terminalId]);

  // Created or restarted here: the view answers its startup queries.
  const fresh = useRef(new Set<string>());
  const [lookups, setLookups] = useState<Map<string, TerminalSession>>(new Map());
  const [missing, setMissing] = useState<Missing | null>(null);
  const [lookupNonce, setLookupNonce] = useState(0);

  const selectedId = route.terminalId;
  const selectedRow = view.rows.find((row) => row.terminal.id === selectedId) ?? null;
  // Terminals listed during this visit. NAV-5 is about links to terminals the
  // page never saw; a listed one that goes away is the list's business.
  const seen = useRef({ projectId: route.projectId, ids: new Set<string>() });
  if (seen.current.projectId !== route.projectId) {
    seen.current = { projectId: route.projectId, ids: new Set() };
  }
  for (const row of view.rows) seen.current.ids.add(row.terminal.id);
  const selectedSession = selectedRow?.terminal ?? (selectedId ? lookups.get(selectedId) : null);
  const listed = view.sections.length > 0 && view.sections.every((section) => section.loaded);

  // NAV-5: a linked terminal that is not listed. Only a confirmed absence
  // (not found, or exited) counts as gone; a failed request keeps the link.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lookupNonce re-runs a retry.
  useEffect(() => {
    if (!selectedId || selectedRow || !store) return;
    // Closed or dismissed here: the action moves the selection itself (ACT-7).
    if (store.removedHere(selectedId)) return;
    // LIST-28: a listed terminal bb no longer has, found on return or later.
    if (view.vanished.has(selectedId)) {
      setMissing({ kind: "gone", terminalId: selectedId, exitCode: null });
      go({ ...route, terminalId: null }, true);
      return;
    }
    if (!listed || lookups.has(selectedId) || seen.current.ids.has(selectedId)) return;
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
  }, [selectedId, selectedRow, listed, lookups, sdk, store, view.vanished, lookupNonce]);

  useEffect(() => {
    if (missing?.kind === "unreachable" && missing.terminalId !== selectedId) setMissing(null);
  }, [missing, selectedId]);

  // A fresh shell's startup queries are answered on its first view only (VIEW-5).
  useEffect(() => {
    if (selectedId && selectedSession) fresh.current.delete(selectedId);
  }, [selectedId, selectedSession]);

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

  // LIST-13: collapsed sections, remembered per project. A root route (no
  // project yet) is not a project switch.
  const [collapsedState, setCollapsedState] = useState(() => ({
    projectId: route.projectId,
    set: route.projectId ? memory.project(route.projectId).collapsed : new Set<string>(),
  }));
  if (route.projectId !== null && collapsedState.projectId !== route.projectId) {
    setCollapsedState({
      projectId: route.projectId,
      set: memory.project(route.projectId).collapsed,
    });
  }
  const collapsed = collapsedState.set;
  const all = route.environment === ALL;
  // The selected environment: the route's, or in All the selected terminal's.
  const selectedEnvironment = all
    ? (environmentOf(view.sections, selectedId) ?? selectedSession?.environmentId ?? null)
    : route.environment;
  // LIST-21: the filter is kept across leaving and returning to the same
  // project, and cleared when the project changes. A root route (no project
  // yet) is not a change: the project it lands on brings its filter back.
  const [filterState, setFilterState] = useState(() => ({
    projectId: route.projectId,
    text: route.projectId ? memory.filterFor(route.projectId) : "",
  }));
  if (route.projectId !== null && filterState.projectId !== route.projectId) {
    setFilterState({
      projectId: route.projectId,
      text: filterState.projectId === null ? memory.filterFor(route.projectId) : "",
    });
  }
  const filter = filterState.text;
  useEffect(() => {
    if (route.projectId !== null && memory.filter && memory.filter.projectId !== route.projectId) {
      memory.filter = null;
    }
  }, [memory, route.projectId]);
  const setFilter = (text: string) => {
    setFilterState((current) => ({ ...current, text }));
    if (route.projectId !== null) memory.filter = { projectId: route.projectId, text };
  };
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const words = filterWords(filter);
  const filtering = words.length > 0;
  const filterContext = { words, hints: view.hints, homes: view.homes };

  let shown: Section[];
  let empty: Section[] = [];
  if (!filtering) {
    shown = all ? splitSections(view.sections, selectedEnvironment).shown : view.sections;
  } else if (all) {
    // LIST-19: matching sections and failed ones; matching empty environments.
    ({ shown, emptyMatches: empty } = filterAll(view.sections, filterContext, view.complete));
  } else {
    shown = view.sections.map((section) => filterSection(section, filterContext));
  }
  // ACT-7: the next selection follows what the list shows.
  const order = filtering
    ? filteredOrder(view.sections, shown, selectedId)
    : all
      ? visibleOrder(shown, collapsed, selectedId)
      : view.rows.map((row) => row.terminal.id);
  useRememberedScroll(scrollerRef, memory, route.projectId, order);

  const doClose = async (row: HubRow) => {
    if (!store) return;
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
        store?.replace(row.terminal.id, session);
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
      store?.dismiss(row.terminal.id);
      if (row.terminal.id === selectedId) select(nextSelection(order, row.terminal.id), true);
    },
  };

  // LIST-9: an interactive shell at environment scope, selected. From a single
  // environment, starting one in another switches the list there.
  const newTerminal = async (environmentId: string) => {
    setCreating(environmentId);
    try {
      const session = await sdk.terminals.create({
        ...NEW_TERMINAL_SIZE,
        scope: { kind: "environment", environmentId },
        start: { mode: "shell" },
      });
      fresh.current.add(session.id);
      store?.upsert(session);
      setMissing(null);
      go({ ...route, environment: all ? ALL : environmentId, terminalId: session.id }, false);
    } catch (error) {
      toast.error(`Could not start a terminal: ${message(error)}`);
    } finally {
      setCreating(null);
    }
  };

  // ACT-5: refresh first, so the confirmation lists what is stale now. The
  // scope it was opened for must still be the page's when the refresh ends.
  const [checkingStale, setCheckingStale] = useState(false);
  const scope = useRef({ store, environment: route.environment });
  scope.current = { store, environment: route.environment };
  const openCleanup = async () => {
    const opened = scope.current;
    if (!opened.store) return;
    setCheckingStale(true);
    let ok = false;
    try {
      ok = await opened.store.refresh(opened.environment);
    } finally {
      setCheckingStale(false);
    }
    const now = scope.current;
    if (now.store !== opened.store || now.environment !== opened.environment) return;
    if (!ok) {
      toast.error("Could not check for stale terminals. Try again in a moment.");
      return;
    }
    const targets = settledTargets(opened.store.viewFor(opened.environment).rows);
    if (targets.length === 0) toast.success("Nothing to clean up: no stale terminals now.");
    else setBulk(targets);
  };
  // VIEW-9, ACT-8: the bar acts on the listed row, or on a linked terminal
  // the list does not hold (NAV-5), whose owner the list does not know.
  const barRow: HubRow | null =
    selectedRow ??
    (selectedSession ? { terminal: selectedSession, thread: null, stale: false } : null);
  const barEnvironment = selectedSession
    ? (view.environments?.find((env) => env.id === selectedSession.environmentId)?.name ?? null)
    : null;

  const runBulk = async () => {
    if (!bulk || !store) return;
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
      if (result.skipped.length > 0) {
        toast(
          `Left ${result.skipped.length} open that ${result.skipped.length === 1 ? "is" : "are"} no longer stale: ${result.skipped
            .map((row) => row.terminal.title || row.terminal.id)
            .join(", ")}`,
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
    // LIST-22: `/` from anywhere in the page focuses the filter. The root takes
    // focus from clicks on blank space (tabIndex -1), so the page counts as
    // focused without making the root a Tab stop.
    // biome-ignore lint/a11y/noStaticElementInteractions: the handler acts on `/` only.
    <div
      tabIndex={-1}
      className="flex h-full min-h-0 flex-1 outline-none"
      onKeyDown={(event) => {
        if (!isFilterShortcut(event)) return;
        event.preventDefault();
        event.stopPropagation();
        filterRef.current?.focus();
        filterRef.current?.select();
      }}
    >
      <aside
        aria-label="Terminal list"
        className="flex w-80 shrink-0 flex-col border-r border-border"
      >
        <div className="flex flex-col gap-0.5 px-2.5 pb-1.5 pt-2.5">
          {/* LIST-26: project / environment, as borderless triggers on one line. */}
          <div className="flex min-w-0 items-center gap-0.5 pb-1.5">
            <Select
              value={route.projectId ?? ""}
              onValueChange={(projectId) =>
                go({ projectId, environment: ALL, terminalId: null }, true)
              }
            >
              <SelectTrigger
                aria-label="Project"
                className={cn(SCOPE_TRIGGER, "shrink-[3] font-semibold")}
              >
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                {(projects ?? []).map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span aria-hidden="true" className="shrink-0 text-muted-foreground/60">
              /
            </span>
            <Select
              value={route.environment}
              onValueChange={(environment) => go({ ...route, environment, terminalId: null }, true)}
            >
              <SelectTrigger
                aria-label="Environment"
                className={cn(SCOPE_TRIGGER, "font-medium text-foreground/80")}
              >
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
          <NewTerminalButton
            environments={environmentOptions}
            targetId={selectedEnvironment}
            creating={creating}
            onCreate={(environmentId) => void newTerminal(environmentId)}
          />
          <div className="mt-1">
            <FilterBox value={filter} onChange={setFilter} inputRef={filterRef} listRef={listRef} />
          </div>
          <div className="pt-1.5">
            <SummaryLine
              summary={summarize(view.rows, view.hints)}
              freshness={view.freshness}
              checking={checkingStale}
              onStale={() => void openCleanup()}
            />
          </div>
        </div>
        <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-1">
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
            shown={shown}
            empty={empty}
            filter={filtering ? filter.trim() : ""}
            listRef={listRef}
            focusFilter={() => filterRef.current?.focus()}
            collapsed={collapsed}
            onToggleSection={(environmentId) => {
              const next = new Set(collapsed);
              if (!next.delete(environmentId)) next.add(environmentId);
              if (route.projectId !== null) memory.project(route.projectId).collapsed = next;
              setCollapsedState({ projectId: route.projectId, set: next });
            }}
            onSelectEnvironment={(environment) =>
              go({ ...route, environment, terminalId: null }, true)
            }
          />
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        {selectedSession && selectedId && barRow ? (
          <>
            <TerminalBar
              row={barRow}
              environmentName={barEnvironment}
              hint={view.hints.get(selectedId)}
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
                onExit={(id, status, exitCode) => store?.noteEnded(id, status, exitCode)}
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
        ) : (
          // LIST-25: the sentence for the state, and a way to start a shell.
          <EmptyPane
            message={
              view.rows.length > 0
                ? "Select a terminal to see it here."
                : view.complete
                  ? "No terminals found. Start one with New terminal in…"
                  : view.error
                    ? "Could not list every terminal yet; trying again shortly."
                    : "Looking for terminals…"
            }
            action={
              (view.rows.length > 0 || view.complete) && environmentOptions.length > 0 ? (
                <NewTerminalButton
                  appearance="solid"
                  environments={environmentOptions}
                  targetId={selectedEnvironment}
                  creating={creating}
                  onCreate={(environmentId) => void newTerminal(environmentId)}
                />
              ) : null
            }
          />
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
            // A linked terminal the list does not hold (NAV-5) shows from here.
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
