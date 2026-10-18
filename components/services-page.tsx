// Services: the servers running in bb environments outside bb terminals, as
// one full-width table grouped by environment, with the selected process's
// log in a drawer below it. Rows an agent service record labels are named and
// shown under their set, and the drawer adds how to connect (ADR 202610180513). Shown as the Terminals page's main view from a
// button in its title bar (ADR 202610171823). The server entry scans and
// signals the processes; the page asks it over plugin RPC. Nothing here lives
// in the URL (SVC-21).
import {
  experimental_copyToClipboard,
  type PluginNavPanelProps,
  useBbNavigate,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dialogs";
import { EmptyPane } from "@/components/empty-pane";
import { BAND_CLASS } from "@/components/environment-rail";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/useNow";
import { message } from "@/lib/hub-store";
import type {
  Connect,
  Service,
  ServiceGroup,
  ServiceSet,
  ServicesContract,
  ServicesList,
  StopExpectation,
} from "@/lib/services-contract";
import { type ServicesStore, servicesStoreFor } from "@/lib/services-store";
import {
  filterGroups,
  findWords,
  hasPassword,
  localLink,
  MASK,
  maskUrl,
  programName,
  serviceCount,
  serviceKey,
  setLabel,
  setRuns,
} from "@/lib/services-view";
import { formatAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

/** SVC-10: how often the list is scanned while the Services view is shown. */
export const SERVICES_REFRESH_MS = 5_000;
/** SVC-10: how often the button's count is refreshed otherwise. */
export const COUNT_REFRESH_MS = 30_000;
/** SVC-5: how often the drawer's log is read while shown. */
export const LOG_REFRESH_MS = 2_000;
/** SVC-9: how long after Stop a process still listed offers Force stop. */
export const FORCE_STOP_AFTER_MS = 5_000;

export type Rpc = ReturnType<typeof useRpc<ServicesContract>>;

/** bb's secondary text colour (ADR 202610180433), not `--muted-foreground`. */
const SUBTLE = "text-[var(--subtle-foreground)]";
const DESTRUCTIVE_TEXT = "text-[var(--destructive-text)]";
/** Icon buttons: 28px, 36px on a coarse pointer. */
const ICON_BUTTON_CLASS = cn(
  "size-7 shrink-0 rounded-md pointer-coarse:size-9 [&_[data-icon-root]]:size-3.5",
  SUBTLE,
);
/** The drawer's labelled buttons. */
const DRAWER_BUTTON_CLASS =
  "h-7 gap-1.5 border-foreground/12 px-2.5 text-[12.5px] font-normal pointer-coarse:h-9 [&_[data-icon-root]]:size-3.5";
const STOP_BUTTON_CLASS = cn("border-destructive/35", DESTRUCTIVE_TEXT);

/** SVC-6: where "Open" points for a port. */
export function serviceUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * SVC-10: the list, scanned every 5 s while the Services view is shown, and
 * every 30 s for the button's count while it is not; one scan at a time, none
 * while the page is hidden. The Terminals page runs it, as it is always
 * mounted while the button is.
 */
export function useServicesPolling(rpc: Rpc, store: ServicesStore, visible: boolean) {
  const { view, nonce } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  useEffect(() => {
    if (!visible) return;
    const interval = view === "services" ? SERVICES_REFRESH_MS : COUNT_REFRESH_MS;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scan = async () => {
      try {
        const next = await rpcRef.current.call("services.list", null);
        if (!cancelled) store.scanned(next, Date.now());
      } catch (cause) {
        if (!cancelled) store.failed(message(cause), Date.now());
      }
      if (!cancelled) timer = setTimeout(scan, interval);
    };
    // Due when the last scan is as old as the interval; at once when asked.
    const last = store.getSnapshot().scannedAt;
    const asked = nonce !== askedNonce.get(store);
    askedNonce.set(store, nonce);
    const due = asked ? 0 : Math.max(0, last + interval - Date.now());
    timer = setTimeout(scan, due);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [store, view, visible, nonce]);
}

/** The refresh request each store last answered. */
const askedNonce = new WeakMap<ServicesStore, number>();

/**
 * SVC-1: the "Services" button in the Terminals page's title bar: the number
 * of listed services when above zero, pressed while the Services view shows.
 */
export function ServicesButton(_props: PluginNavPanelProps) {
  const store = servicesStoreFor(useSdk());
  const { view, list } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const count = list ? serviceCount(list.groups) : 0;
  const shown = view === "services";
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={shown}
      aria-label={count > 0 ? `Services, ${count} running` : "Services"}
      onClick={() => store.toggleView()}
      className="h-7 gap-1.5 px-2 text-[12.5px] text-muted-foreground [&_[data-icon-root]]:size-3.5"
    >
      <Icon name="Zap" aria-hidden="true" />
      Services
      {count > 0 ? (
        <span data-services-count="" className="tabular-nums text-foreground/80">
          {count}
        </span>
      ) : null}
    </Button>
  );
}

type LogState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "log"; path: string; text: string; error: string | null };

/** SVC-5, SVC-16: the selected process's log, read while shown; kept once it ended. */
function useServiceLog(rpc: Rpc, service: Service | null, listed: boolean, visible: boolean) {
  const [state, setState] = useState<{ key: string; log: LogState } | null>(null);
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const key = service ? serviceKey(service) : null;
  const pid = service?.pid;
  const startedAt = service?.startedAt;
  useEffect(() => {
    if (key === null || pid === undefined || startedAt === undefined) return;
    if (!listed || !visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const result = await rpcRef.current.call("services.log", { pid, startedAt });
        if (cancelled) return;
        // Ended: the list says so on its next scan; keep what was shown.
        if (result.outcome === "none") setState({ key, log: { kind: "none" } });
        else if (result.outcome === "log") setState({ key, log: { kind: "log", ...result } });
      } catch {
        // Kept as last read; tried again below.
      }
      if (!cancelled) timer = setTimeout(read, LOG_REFRESH_MS);
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, pid, startedAt, listed, visible]);
  return state && state.key === key ? state.log : ({ kind: "loading" } as const);
}

type ConnectState = Exclude<Connect, { outcome: "ended" }>;

/**
 * SVC-28: the selected process's URLs and its set's credentials, asked for
 * once per selection, and only for a labelled process; kept once it ended.
 */
function useServiceConnect(rpc: Rpc, service: Service | null, listed: boolean) {
  const [state, setState] = useState<{ key: string; connect: ConnectState } | null>(null);
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const key = service ? serviceKey(service) : null;
  const pid = service?.pid;
  const startedAt = service?.startedAt;
  const labelled = Boolean(service?.name && service.set);
  useEffect(() => {
    if (key === null || pid === undefined || startedAt === undefined) return;
    if (!listed || !labelled) return;
    let cancelled = false;
    void rpcRef.current.call("services.connect", { pid, startedAt }).then(
      (result) => {
        if (!cancelled && result.outcome !== "ended") setState({ key, connect: result });
      },
      () => {
        // Shown without a Connect section.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, pid, startedAt, listed, labelled]);
  return state && state.key === key ? state.connect : null;
}

async function copy(text: string, what: string) {
  const ok = await experimental_copyToClipboard({ text });
  if (ok) toast(`Copied ${what}`);
  else toast.error(`Could not copy ${what}`);
}

/**
 * The Services view: the main view of the Terminals page while the title-bar
 * button is pressed (SVC-1). Its row selection lives here only, so it opens
 * with nothing selected (SVC-21).
 */
export function ServicesView({ store, visible }: { store: ServicesStore; visible: boolean }) {
  const rpc = useRpc<ServicesContract>();
  const navigate = useBbNavigate();
  const { list, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const refresh = () => store.refresh();
  const now = useNow(30_000);
  const [find, setFind] = useState("");

  // SVC-5, SVC-16, SVC-21: the selected row, kept here only; once the process
  // is no longer listed, the drawer shows it as it was.
  const [selected, setSelected] = useState<Service | null>(null);
  const allServices = (list?.groups ?? []).flatMap((group) => group.services);
  const selectedKey = selected ? serviceKey(selected) : null;
  const current = allServices.find((service) => serviceKey(service) === selectedKey) ?? null;
  const ended = selected !== null && list !== null && current === null;
  const shown = current ?? selected;
  const log = useServiceLog(rpc, shown, !ended, visible);
  const connect = useServiceConnect(rpc, shown, !ended);

  // SVC-8, SVC-9: when each process was sent SIGTERM from here.
  const [stopped, setStopped] = useState<ReadonlyMap<string, number>>(new Map());
  const [, setTick] = useState(0);
  useEffect(() => {
    const waits = [...stopped.values()]
      .map((at) => at + FORCE_STOP_AFTER_MS - Date.now())
      .filter((wait) => wait > 0);
    if (waits.length === 0) return;
    const due = Math.min(...waits);
    const timer = setTimeout(() => {
      setTick((n) => n + 1);
      refresh();
    }, due);
    return () => clearTimeout(timer);
  });
  const stopState = (service: Service): "none" | "stopping" | "force" => {
    const at = stopped.get(serviceKey(service));
    if (at === undefined) return "none";
    return Date.now() - at >= FORCE_STOP_AFTER_MS ? "force" : "stopping";
  };

  const [confirming, setConfirming] = useState<{
    service: Service;
    commands: string[];
    expected: StopExpectation;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const changed = () => {
    toast.error("That process changed since the list was read; the list is refreshed.");
    refresh();
  };

  /** SVC-19: what Stop would signal now; null when the process changed. */
  const planStop = async (service: Service) => {
    const plan = await rpc.call("services.plan", {
      pid: service.pid,
      startedAt: service.startedAt,
    });
    if (plan.outcome === "changed") return null;
    const expected: StopExpectation = {
      scope: plan.scope,
      target: plan.target,
      count: plan.commands.length,
    };
    return { commands: plan.commands, expected };
  };

  // SVC-8, SVC-19: ask the server what Stop reaches, then confirm.
  const askStop = async (service: Service) => {
    try {
      const plan = await planStop(service);
      if (plan === null) changed();
      else setConfirming({ service, ...plan });
    } catch (cause) {
      toast.error(`Could not stop the process: ${message(cause)}`);
    }
  };

  // SVC-8, SVC-9, SVC-19: SIGTERM to what the confirmation named; SIGKILL
  // from Force stop, to what the same check names now. Anything else that
  // changed meanwhile is reported, not signalled.
  const stop = async (service: Service, force: boolean, confirmed?: StopExpectation) => {
    setBusy(true);
    try {
      const expected = confirmed ?? (await planStop(service))?.expected;
      if (!expected) {
        changed();
        return;
      }
      const result = await rpc.call("services.stop", {
        pid: service.pid,
        startedAt: service.startedAt,
        force,
        expected,
      });
      if (result.outcome === "changed") changed();
      else {
        if (!force) setStopped((map) => new Map(map).set(serviceKey(service), Date.now()));
        refresh();
      }
    } catch (cause) {
      toast.error(`Could not stop the process: ${message(cause)}`);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const words = findWords(find);
  const groups = filterGroups(list?.groups ?? [], words);
  const count = serviceCount(list?.groups ?? []);

  let body: ReactNode;
  if (list === null) {
    body = error ? (
      <EmptyPane icon="Zap" message={`Could not list services: ${error}`} />
    ) : (
      <EmptyPane icon="Zap" message="Looking for services…" />
    );
  } else if (!list.available) {
    // SVC-12
    body = (
      <EmptyPane
        icon="Zap"
        message="Service detection is unavailable on this machine: lsof was not found."
      />
    );
  } else if (count === 0 && (groups.length === 0 || words.length > 0)) {
    // SVC-17, SVC-11
    body = (
      <EmptyPane icon="Zap" message={emptyMessage(list)}>
        {list.hostKnown ? <p>{EMPTY_EXPLANATION}</p> : null}
      </EmptyPane>
    );
  } else if (groups.length === 0) {
    body = (
      <p className="px-4 pt-4 text-[12.5px] text-muted-foreground">
        No service matches “{find.trim()}”.
      </p>
    );
  } else {
    body = (
      <>
        {count === 0 ? (
          // SVC-17, SVC-11: nothing listed here, and other hosts are not checked.
          <div data-services-empty="" className={cn("px-5 pb-2 pt-4 text-[12.5px]", SUBTLE)}>
            <p className="text-foreground/90">{emptyMessage(list)}</p>
            {list.hostKnown ? <p>{EMPTY_EXPLANATION}</p> : null}
          </div>
        ) : null}
        <ServicesTable
          groups={groups}
          selectedKey={current ? selectedKey : null}
          now={now}
          stopState={stopState}
          onSelect={setSelected}
          onOpenThread={(threadId) => navigate.toThread(threadId)}
          onStop={(service) => void askStop(service)}
          onForceStop={(service) => void stop(service, true)}
        />
      </>
    );
  }
  const shownStop = shown && !ended ? stopState(shown) : "none";

  return (
    <TooltipProvider delayDuration={300}>
      <section aria-label="Services" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <header className={cn(BAND_CLASS, "flex items-center gap-3 pl-5 pr-3")}>
          <h2 className="text-[13px] font-semibold">Services</h2>
          <label
            className={cn(
              "ml-auto flex h-7 w-[240px] min-w-0 items-center gap-2 rounded-md bg-foreground/[0.04] px-2 focus-within:ring-1 focus-within:ring-ring",
              SUBTLE,
            )}
          >
            <Icon name="Search" className="size-3.5 shrink-0" aria-hidden="true" />
            <input
              type="text"
              value={find}
              onChange={(event) => setFind(event.target.value)}
              placeholder="Find"
              aria-label="Find service"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-[var(--subtle-foreground)]"
            />
          </label>
        </header>
        {list?.error || (list && error) ? (
          <p
            role="alert"
            className="shrink-0 border-b border-foreground/8 px-4 py-1.5 text-[12px] text-destructive"
          >
            {error
              ? `Could not list services: ${error}`
              : `Could not list every environment: ${list?.error}`}
          </p>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">{body}</div>
        {shown ? (
          <LogDrawer
            service={shown}
            ended={ended}
            log={log}
            connect={connect}
            now={now}
            stop={shownStop}
            onStop={() => void askStop(shown)}
            onForceStop={() => void stop(shown, true)}
            onClose={() => setSelected(null)}
          />
        ) : null}
        <ConfirmDialog
          open={confirming !== null}
          title="Stop this process?"
          description={confirming ? stopDescription(confirming.service, confirming.commands) : null}
          confirmLabel="Stop"
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => confirming && void stop(confirming.service, false, confirming.expected)}
        >
          {confirming && confirming.commands.length > 1 ? (
            <ul
              data-stop-commands=""
              className="max-h-40 overflow-y-auto rounded-md bg-foreground/[0.04] px-3 py-2 font-mono text-[11.5px] text-muted-foreground"
            >
              {confirming.commands.map((command, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: commands repeat; the list never reorders.
                <li key={index} className="truncate" title={command}>
                  {command}
                </li>
              ))}
            </ul>
          ) : null}
        </ConfirmDialog>
      </section>
    </TooltipProvider>
  );
}

const EMPTY_EXPLANATION =
  "Services lists processes listening on a port inside an environment's folder, or started by one of its threads, that are not running in a bb terminal.";

/** SVC-17; SVC-11: without bb's own host, no environment could be checked. */
function emptyMessage(list: ServicesList): string {
  return list.hostKnown
    ? "No servers running in your environments."
    : "Could not tell which machine bb runs on, so no environment was checked.";
}

/** SVC-19: how many processes Stop signals. */
function stopDescription(service: Service, commands: readonly string[]): string {
  if (commands.length <= 1) {
    return `Sends SIGTERM to 1 process: PID ${service.pid}, “${service.command}”.`;
  }
  return `Sends SIGTERM to ${commands.length} processes: PID ${service.pid} and the processes started with it.`;
}

type StopState = "none" | "stopping" | "force";

function ServicesTable({
  groups,
  selectedKey,
  now,
  stopState,
  onSelect,
  onOpenThread,
  onStop,
  onForceStop,
}: {
  groups: readonly ServiceGroup[];
  selectedKey: string | null;
  now: number;
  stopState: (service: Service) => StopState;
  onSelect: (service: Service) => void;
  onOpenThread: (threadId: string) => void;
  onStop: (service: Service) => void;
  onForceStop: (service: Service) => void;
}) {
  const states = groups.flatMap((group) => group.services.map(stopState));
  const head = cn("px-[10px] pb-1.5 pt-3.5 text-left text-[12px] font-normal", SUBTLE);
  return (
    <table aria-label="Services" className="w-full table-fixed border-collapse text-[13px]">
      <colgroup>
        <col className="w-[116px]" />
        <col className="w-[150px]" />
        <col />
        <col className={states.includes("stopping") ? "w-[88px]" : "w-[56px]"} />
        <col className={states.includes("force") ? "w-[136px]" : "w-[52px]"} />
      </colgroup>
      <thead className="sticky top-0 z-[1] bg-background">
        <tr>
          <th scope="col" className={cn(head, "pl-5")}>
            Port
          </th>
          <th scope="col" className={head}>
            Program
          </th>
          <th scope="col" className={head}>
            Started by
          </th>
          <th scope="col" className={cn(head, "text-right")}>
            Up
          </th>
          <th scope="col" className={head}>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.environmentId} data-environment-id={group.environmentId}>
          <tr>
            <th
              scope="colgroup"
              colSpan={5}
              className="px-5 pb-1.5 pt-[18px] text-left text-[12.5px] font-normal"
            >
              <GroupHeading group={group} />
            </th>
          </tr>
          {group.checked ? (
            setRuns(group.services).map((run, index) => (
              // The server keeps each set's rows together (SVC-25): one run per set.
              <Fragment key={run.set ? `set:${run.set.record}` : "unlabelled"}>
                {run.set ? (
                  <SetRow set={run.set} />
                ) : index > 0 ? (
                  // Unlabelled rows after the sets: a hairline ends the last set.
                  <tr data-set-end="">
                    <td colSpan={5} className="px-5 py-1">
                      <div className="h-px bg-foreground/[0.07]" />
                    </td>
                  </tr>
                ) : null}
                {run.services.map((service) => (
                  <ServiceRow
                    key={serviceKey(service)}
                    service={service}
                    selected={serviceKey(service) === selectedKey}
                    now={now}
                    stop={stopState(service)}
                    onSelect={onSelect}
                    onOpenThread={onOpenThread}
                    onStop={onStop}
                    onForceStop={onForceStop}
                  />
                ))}
              </Fragment>
            ))
          ) : (
            // SVC-11
            <tr>
              <td colSpan={5} className={cn("h-7 pb-1 pl-11 pr-5 text-[12.5px]", SUBTLE)}>
                Not checked: this environment is on another machine.
              </td>
            </tr>
          )}
        </tbody>
      ))}
    </table>
  );
}

/**
 * SVC-14: like bb's sidebar: the project's initial in a chip (neutral: the
 * SDK gives no project colour), its name, then the environment after a branch
 * icon, and a hairline to the edge.
 */
function GroupHeading({ group }: { group: ServiceGroup }) {
  const initial = group.projectName.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-foreground/10 text-[10px] font-bold text-foreground/80"
      >
        {initial}
      </span>
      <span className="shrink-0 font-semibold text-foreground">{group.projectName}</span>
      <span
        className={cn("flex min-w-0 items-center gap-[5px] font-mono text-[12px]", SUBTLE)}
        title={group.environmentName}
      >
        <Icon name="GitBranch" className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{group.environmentName}</span>
      </span>
      <span aria-hidden="true" className="ml-1.5 h-px min-w-5 flex-1 bg-foreground/[0.07]" />
    </div>
  );
}

/**
 * SVC-25: a set's row inside its environment: the record's title, with its
 * case on hover, or the record's folder name when it cannot be read.
 */
function SetRow({ set }: { set: ServiceSet }) {
  const label = setLabel(set);
  return (
    <tr data-service-set={set.record}>
      <td colSpan={5} className="h-7 px-5 pb-0.5 pt-2 align-bottom text-[12px]">
        <span className="flex min-w-0 items-center gap-1.5 text-foreground/75">
          <Icon name="Layers" className={cn("size-3 shrink-0", SUBTLE)} aria-hidden="true" />
          {set.case ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="min-w-0 cursor-default truncate rounded-sm text-left font-medium underline decoration-foreground/30 decoration-dotted underline-offset-4 outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {label}
                </button>
              </TooltipTrigger>
              <TooltipContent
                align="start"
                className="max-w-[440px] whitespace-pre-wrap break-words text-[12px] leading-[1.5]"
              >
                {set.case}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="min-w-0 truncate font-medium">{label}</span>
          )}
        </span>
      </td>
    </tr>
  );
}

/** SVC-6: each port opens `http://127.0.0.1:<port>` in a new tab, without selecting the row. */
function PortLinks({ service, selected }: { service: Service; selected: boolean }) {
  return (
    <span>
      {service.ports.map((port, index) => (
        <span key={port}>
          {index > 0 ? " " : null}
          <a
            href={serviceUrl(port)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open :${port} in a new tab`}
            title={serviceUrl(port)}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded-sm font-mono text-[13px] font-semibold tabular-nums text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
          >
            :{port}
            <Icon
              name="ExternalLink"
              className={cn(
                "size-3",
                SUBTLE,
                selected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
              )}
              aria-hidden="true"
            />
          </a>
        </span>
      ))}
    </span>
  );
}

/**
 * SVC-24: the program's name, underlined with dots; the full command line on
 * hover. SVC-26: a labelled process's name leads, the program after it, muted.
 */
function Program({
  command,
  name,
  className,
}: {
  command: string;
  name: string | null;
  className?: string;
}) {
  const dotted = "underline decoration-foreground/35 decoration-dotted underline-offset-4";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "max-w-full cursor-default truncate rounded-sm text-left font-medium outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
        >
          {name ? (
            <>
              <span data-service-name="" className={dotted}>
                {name}
              </span>{" "}
              <span className={cn("ml-1 font-normal", SUBTLE)}>{programName(command)}</span>
            </>
          ) : (
            <span className={dotted}>{programName(command)}</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent
        align="start"
        className="max-w-[440px] whitespace-normal break-all font-mono text-[11.5px] leading-[1.5]"
      >
        {command}
      </TooltipContent>
    </Tooltip>
  );
}

function ServiceRow({
  service,
  selected,
  now,
  stop,
  onSelect,
  onOpenThread,
  onStop,
  onForceStop,
}: {
  service: Service;
  selected: boolean;
  now: number;
  stop: StopState;
  onSelect: (service: Service) => void;
  onOpenThread: (threadId: string) => void;
  onStop: (service: Service) => void;
  onForceStop: (service: Service) => void;
}) {
  const cell = "h-[38px] overflow-hidden text-ellipsis whitespace-nowrap px-[10px] align-middle";
  return (
    <tr
      data-service-pid={service.pid}
      data-selected={selected ? "" : undefined}
      onClick={() => onSelect(service)}
      className={cn(
        "group/row cursor-default",
        selected ? "bg-foreground/[0.07]" : "hover:bg-foreground/[0.035]",
      )}
    >
      <td
        className={cn(
          cell,
          "border-l-2 pl-[18px]",
          selected ? "border-l-foreground/60" : "border-l-transparent",
        )}
      >
        <PortLinks service={service} selected={selected} />
      </td>
      <td className={cell}>
        <Program command={service.command} name={service.name} />
      </td>
      <td className={cell}>
        {/* SVC-18 */}
        {service.threadId && service.threadTitle !== null ? (
          <button
            type="button"
            title={`Open ${service.threadTitle}`}
            onClick={(event) => {
              event.stopPropagation();
              if (service.threadId) onOpenThread(service.threadId);
            }}
            className="group/by inline-flex max-w-full items-center gap-1.5 rounded-sm text-left text-foreground/80 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon
              name="MessageSquare"
              className={cn("size-3 shrink-0 group-hover/by:text-foreground", SUBTLE)}
              aria-hidden="true"
            />
            <span className="truncate underline-offset-[3px] group-hover/by:underline">
              {service.threadTitle}
            </span>
          </button>
        ) : null}
      </td>
      <td className={cn(cell, "text-right tabular-nums", SUBTLE)}>
        {stop === "none" ? formatAgo(service.startedAt, now) : "Stopping…"}
      </td>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: only keeps clicks on the actions from selecting the row. */}
      <td className={cn(cell, "pr-3")} onClick={(event) => event.stopPropagation()}>
        <span className="flex items-center justify-end gap-1">
          {stop === "force" ? (
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 px-2 text-[12.5px] pointer-coarse:h-9", DESTRUCTIVE_TEXT)}
              onClick={() => onForceStop(service)}
            >
              Force stop
            </Button>
          ) : null}
          <RowMenu service={service} stop={stop} onStop={onStop} />
        </span>
      </td>
    </tr>
  );
}

/** SVC-7: copy the PID, the command line, or a port, and Stop…. */
function RowMenu({
  service,
  stop,
  onStop,
}: {
  service: Service;
  stop: StopState;
  onStop: (service: Service) => void;
}) {
  const program = service.name ?? programName(service.command);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(ICON_BUTTON_CLASS, "[&_[data-icon-root]]:size-4")}
          aria-label={`More actions for ${program} :${service.ports.join(" :")}`}
        >
          <Icon name="MoreHorizontal" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void copy(String(service.pid), "the PID")}>
          Copy PID
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copy(service.command, "the command line")}>
          Copy command line
        </DropdownMenuItem>
        {service.ports.map((port) => (
          <DropdownMenuItem key={port} onSelect={() => void copy(String(port), `port ${port}`)}>
            Copy port :{port}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={stop !== "none"}
          onSelect={() => onStop(service)}
        >
          Stop…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** SVC-6: the drawer's Open: the port, or a menu with one item per port. */
function OpenButton({ service }: { service: Service }) {
  const [only] = service.ports;
  const label = (
    <>
      <Icon name="ExternalLink" aria-hidden="true" />
      Open
    </>
  );
  if (service.ports.length === 1 && only !== undefined) {
    return (
      <Button asChild variant="outline" size="sm" className={DRAWER_BUTTON_CLASS}>
        <a
          href={serviceUrl(only)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open :${only} in a new tab`}
        >
          {label}
        </a>
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={DRAWER_BUTTON_CLASS}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {service.ports.map((port) => (
          <DropdownMenuItem key={port} asChild>
            <a href={serviceUrl(port)} target="_blank" rel="noopener noreferrer">
              Open :{port}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The last segment of a path. */
function fileName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/**
 * SVC-5, SVC-9, SVC-16: the drawer along the bottom: the process's ports,
 * program, PID, uptime and log file, Open and Stop (Force stop when due), and
 * its log's last 64 KB in a recessed panel, kept scrolled to the end unless
 * scrolled up.
 */
function LogDrawer({
  service,
  ended,
  log,
  connect,
  now,
  stop,
  onStop,
  onForceStop,
  onClose,
}: {
  service: Service;
  ended: boolean;
  log: LogState;
  connect: ConnectState | null;
  now: number;
  stop: StopState;
  onStop: () => void;
  onForceStop: () => void;
  onClose: () => void;
}) {
  const scroller = useRef<HTMLPreElement>(null);
  const atEnd = useRef(true);
  const text = log.kind === "log" ? log.text : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows each new text.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && atEnd.current) element.scrollTop = element.scrollHeight;
  }, [text]);
  const key = serviceKey(service);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new process starts at the end.
  useLayoutEffect(() => {
    atEnd.current = true;
  }, [key]);
  const path = log.kind === "log" ? log.path : service.logPath;
  return (
    <section
      aria-label="Log"
      className="flex h-[42%] min-h-[180px] shrink-0 flex-col border-t border-foreground/8 bg-background"
    >
      <div data-drawer-header="" className="flex h-12 shrink-0 items-center gap-3.5 pl-5 pr-2.5">
        <span className="shrink-0 font-mono text-[14px] font-semibold tabular-nums">
          {service.ports.map((port) => `:${port}`).join(" ")}
        </span>
        <Program
          command={service.command}
          name={service.name}
          className="text-[14px] [&>span]:no-underline"
        />
        <span className={cn("flex min-w-0 items-center gap-3.5 text-[12px]", SUBTLE)}>
          <span className="shrink-0">
            PID <b className="font-normal tabular-nums text-foreground/80">{service.pid}</b>
          </span>
          <span className="shrink-0">
            Up{" "}
            <b className="font-normal tabular-nums text-foreground/80">
              {formatAgo(service.startedAt, now)}
            </b>
          </span>
          {path ? (
            <span className="flex min-w-0 items-center gap-1">
              <span
                data-log-path=""
                title={path}
                className="inline-flex min-w-0 items-center gap-[5px] font-mono text-[12px]"
              >
                <Icon name="File" className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{fileName(path)}</span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                className={cn(ICON_BUTTON_CLASS, "size-6 [&_[data-icon-root]]:size-3")}
                aria-label="Copy log path"
                onClick={() => void copy(path, "the log path")}
              >
                <Icon name="Copy" aria-hidden="true" />
              </Button>
            </span>
          ) : null}
        </span>
        <span className="flex-1" />
        {ended ? null : (
          <>
            <OpenButton service={service} />
            {stop === "force" ? (
              <Button
                variant="outline"
                size="sm"
                className={cn(DRAWER_BUTTON_CLASS, STOP_BUTTON_CLASS)}
                onClick={onForceStop}
              >
                Force stop
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className={cn(DRAWER_BUTTON_CLASS, STOP_BUTTON_CLASS)}
                disabled={stop === "stopping"}
                onClick={onStop}
              >
                Stop
              </Button>
            )}
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(ICON_BUTTON_CLASS, "[&_[data-icon-root]]:size-4")}
          aria-label="Close log"
          onClick={onClose}
        >
          <Icon name="X" aria-hidden="true" />
        </Button>
      </div>
      {ended ? (
        <p role="status" className={cn("shrink-0 px-5 pb-2 text-[12px]", SUBTLE)}>
          This process ended.
        </p>
      ) : null}
      {connect?.outcome === "connect" &&
      (connect.urls.length > 0 || connect.credentials.length > 0) ? (
        <ConnectSection key={key} connect={connect} />
      ) : null}
      {log.kind === "log" && log.error ? (
        <p role="alert" className="shrink-0 px-5 pb-2 text-[12px] text-destructive">
          Could not read the log: {log.error}
        </p>
      ) : null}
      {log.kind === "none" ? (
        <p className={cn("px-5 py-3 text-[12.5px]", SUBTLE)}>
          This process has no log file: its standard output is not a file.
        </p>
      ) : log.kind === "loading" ? (
        <p className={cn("px-5 py-3 text-[12.5px]", SUBTLE)}>{ended ? "" : "Reading the log…"}</p>
      ) : (
        <pre
          ref={scroller}
          data-log=""
          onScroll={(event) => {
            const element = event.currentTarget;
            atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
          }}
          className="mx-3 mb-3 min-h-0 flex-1 overflow-auto whitespace-pre rounded-lg bg-[var(--surface-recessed)] px-3 py-2.5 font-mono text-[12px] leading-[1.55] text-foreground/[0.88] outline-none"
        >
          {text}
        </pre>
      )}
    </section>
  );
}

/**
 * SVC-28, SVC-29: how to reach the selected service, from its record: its
 * URLs, each with its label, and its set's credentials, each with its label
 * and username. Passwords and secrets show as `••••` until Show; copying
 * gives the full value. Only local http(s) URLs are links. All plain text.
 */
function ConnectSection({ connect }: { connect: Extract<ConnectState, { outcome: "connect" }> }) {
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setShown((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const labelClass = cn("truncate pr-3 text-[12px]", SUBTLE);
  const valueClass = "min-w-0 truncate font-mono text-[12px] text-foreground/[0.88]";
  return (
    <section
      aria-label="Connect"
      className="max-h-[45%] shrink-0 overflow-y-auto px-5 pb-2.5 [&_[data-icon-root]]:size-3"
    >
      <div className="grid grid-cols-[minmax(80px,max-content)_minmax(0,1fr)_auto] items-center gap-y-0.5">
        {connect.urls.map((entry, index) => {
          const id = `url:${index}`;
          const secret = hasPassword(entry.url);
          const revealed = !secret || shown.has(id);
          const text = revealed ? entry.url : maskUrl(entry.url);
          const href = localLink(entry.url, revealed);
          return (
            <div key={id} data-connect-url="" className="contents">
              <span className={labelClass} title={entry.label}>
                {entry.label}
              </span>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    valueClass,
                    "w-fit max-w-full rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring",
                  )}
                >
                  {text}
                </a>
              ) : (
                <span className={valueClass}>{text}</span>
              )}
              <span className="flex items-center justify-end gap-0.5 pl-2">
                {secret ? (
                  <RevealButton
                    label={entry.label}
                    shown={shown.has(id)}
                    onToggle={() => toggle(id)}
                  />
                ) : null}
                <CopyButton
                  label={`Copy ${entry.label} URL`}
                  onCopy={() => copy(entry.url, `the ${entry.label} URL`)}
                />
              </span>
            </div>
          );
        })}
        {connect.credentials.map((credential, index) => {
          const id = `secret:${index}`;
          return (
            <div key={id} data-connect-credential="" className="contents">
              <span className={labelClass} title={credential.label}>
                {credential.label}
              </span>
              <span className={cn(valueClass, "flex gap-3")}>
                {credential.username !== null ? (
                  <span className="truncate">{credential.username}</span>
                ) : null}
                {credential.secret !== null ? (
                  <span data-secret="" className="truncate">
                    {shown.has(id) ? credential.secret : MASK}
                  </span>
                ) : null}
              </span>
              <span className="flex items-center justify-end gap-0.5 pl-2">
                {credential.secret !== null ? (
                  <RevealButton
                    label={credential.label}
                    shown={shown.has(id)}
                    onToggle={() => toggle(id)}
                  />
                ) : null}
                {credential.username !== null ? (
                  <CopyButton
                    label={`Copy ${credential.label} username`}
                    onCopy={() =>
                      copy(credential.username ?? "", `the ${credential.label} username`)
                    }
                  />
                ) : null}
                {credential.secret !== null ? (
                  <CopyButton
                    label={`Copy ${credential.label} secret`}
                    icon="KeyRound"
                    onCopy={() => copy(credential.secret ?? "", `the ${credential.label} secret`)}
                  />
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** SVC-29: Show and Hide for one masked value. */
function RevealButton({
  label,
  shown,
  onToggle,
}: {
  label: string;
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={shown}
      aria-label={`${shown ? "Hide" : "Show"} ${label}`}
      onClick={onToggle}
      className={cn("h-6 px-1.5 text-[11.5px] font-normal pointer-coarse:h-9", SUBTLE)}
    >
      {shown ? "Hide" : "Show"}
    </Button>
  );
}

function CopyButton({
  label,
  icon = "Copy",
  onCopy,
}: {
  label: string;
  icon?: string;
  onCopy: () => Promise<void>;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(ICON_BUTTON_CLASS, "size-6")}
      aria-label={label}
      onClick={() => void onCopy()}
    >
      <Icon name={icon} aria-hidden="true" />
    </Button>
  );
}
