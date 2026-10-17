// The Services page: the servers running in bb environments outside bb
// terminals, as one full-width table grouped by environment, with the
// selected process's log in a drawer below it (ADR 202610171646). The server
// entry scans and signals the processes; the page asks it over plugin RPC.
// Nothing here lives in the URL (SVC-21).
import {
  experimental_copyToClipboard,
  type PluginNavPanelProps,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dialogs";
import { EmptyPane } from "@/components/empty-pane";
import { BAND_CLASS } from "@/components/environment-rail";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { useNow } from "@/hooks/useNow";
import { message } from "@/lib/hub-store";
import type {
  Service,
  ServiceGroup,
  ServicesContract,
  ServicesList,
} from "@/lib/services-contract";
import { filterGroups, findWords, serviceCount, serviceKey } from "@/lib/services-view";
import { formatAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

/** SVC-10: how often the list is scanned while the page is visible. */
export const SERVICES_REFRESH_MS = 5_000;
/** SVC-5: how often the drawer's log is read while shown. */
export const LOG_REFRESH_MS = 2_000;
/** SVC-9: how long after Stop a process still listed offers Force stop. */
export const FORCE_STOP_AFTER_MS = 5_000;

type Rpc = ReturnType<typeof useRpc<ServicesContract>>;

/** Row icon buttons: 28px, 36px on a coarse pointer. */
const ACTION_BUTTON_CLASS =
  "size-7 shrink-0 rounded-md text-muted-foreground pointer-coarse:size-9 [&_[data-icon-root]]:size-3.5";

/** SVC-6: where "Open" points for a port. */
export function serviceUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/**
 * SVC-10: the list, scanned when the page opens and every 5 s while it is
 * visible; one scan at a time, none while hidden.
 */
function useServicesList(rpc: Rpc, visible: boolean) {
  const [list, setList] = useState<ServicesList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce asks for a scan now.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scan = async () => {
      try {
        const next = await rpcRef.current.call("services.list", null);
        if (cancelled) return;
        setList(next);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(message(cause));
      }
      if (!cancelled) timer = setTimeout(scan, SERVICES_REFRESH_MS);
    };
    void scan();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, nonce]);
  return { list, error, refresh: () => setNonce((n) => n + 1) };
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

async function copy(text: string, what: string) {
  const ok = await experimental_copyToClipboard({ text });
  if (ok) toast(`Copied ${what}`);
  else toast.error(`Could not copy ${what}`);
}

export function ServicesPage(_props: PluginNavPanelProps) {
  const rpc = useRpc<ServicesContract>();
  const navigate = useBbNavigate();
  const visible = useVisible();
  const { list, error, refresh } = useServicesList(rpc, visible);
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
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const changed = () => {
    toast.error("That process changed since the list was read; the list is refreshed.");
    refresh();
  };

  // SVC-8, SVC-19: ask the server what Stop reaches, then confirm.
  const askStop = async (service: Service) => {
    try {
      const plan = await rpc.call("services.plan", {
        pid: service.pid,
        startedAt: service.startedAt,
      });
      if (plan.outcome === "changed") changed();
      else setConfirming({ service, commands: plan.commands });
    } catch (cause) {
      toast.error(`Could not stop the process: ${message(cause)}`);
    }
  };

  // SVC-8, SVC-9: SIGTERM after confirming; SIGKILL from Force stop.
  const stop = async (service: Service, force: boolean) => {
    setBusy(true);
    try {
      const result = await rpc.call("services.stop", {
        pid: service.pid,
        startedAt: service.startedAt,
        force,
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
      <EmptyPane icon="Server" message={`Could not list services: ${error}`} />
    ) : (
      <EmptyPane icon="Server" message="Looking for services…" />
    );
  } else if (!list.available) {
    // SVC-12
    body = (
      <EmptyPane
        icon="Server"
        message="Service detection is unavailable on this machine: lsof was not found."
      />
    );
  } else if (count === 0) {
    // SVC-17
    body = (
      <EmptyPane icon="Server" message="No servers running in your environments.">
        <p>
          Services lists processes listening on a port inside an environment's folder, or started by
          one of its threads, that are not running in a bb terminal.
        </p>
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
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className={cn(BAND_CLASS, "flex items-center gap-3 pl-4 pr-3")}>
        <h1 className="text-[13px] font-medium">Services</h1>
        <label className="ml-auto flex h-7 w-[240px] min-w-0 items-center gap-2 rounded-md bg-foreground/[0.04] px-2 text-muted-foreground focus-within:ring-1 focus-within:ring-ring">
          <Icon name="Search" className="size-3.5 shrink-0" aria-hidden="true" />
          <input
            type="text"
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="Find"
            aria-label="Find service"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </label>
        <span
          data-services-count=""
          className="shrink-0 text-[12px] tabular-nums text-muted-foreground"
        >
          {count} running
        </span>
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
        <LogDrawer service={shown} ended={ended} log={log} onClose={() => setSelected(null)} />
      ) : null}
      <ConfirmDialog
        open={confirming !== null}
        title="Stop this process?"
        description={confirming ? stopDescription(confirming.service, confirming.commands) : null}
        confirmLabel="Stop"
        busy={busy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && void stop(confirming.service, false)}
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
    </div>
  );
}

/** SVC-19: how many processes Stop signals. */
function stopDescription(service: Service, commands: readonly string[]): string {
  if (commands.length <= 1) {
    return `Sends SIGTERM to 1 process: PID ${service.pid}, “${service.command}”.`;
  }
  return `Sends SIGTERM to ${commands.length} processes: PID ${service.pid} and the processes started with it.`;
}

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
  stopState: (service: Service) => "none" | "stopping" | "force";
  onSelect: (service: Service) => void;
  onOpenThread: (threadId: string) => void;
  onStop: (service: Service) => void;
  onForceStop: (service: Service) => void;
}) {
  const head = "px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide";
  return (
    <table aria-label="Services" className="w-full table-fixed border-collapse text-[12.5px]">
      <thead className="sticky top-0 z-[1] bg-background text-muted-foreground">
        <tr className="border-b border-foreground/8">
          <th scope="col" className={cn(head, "w-[120px] pl-4")}>
            Port
          </th>
          <th scope="col" className={head}>
            Process
          </th>
          <th scope="col" className={cn(head, "w-[200px]")}>
            Started by
          </th>
          <th scope="col" className={cn(head, "w-[76px]")}>
            PID
          </th>
          <th scope="col" className={cn(head, "w-[52px]")}>
            Up
          </th>
          <th scope="col" className={cn(head, "w-[112px] pr-3")}>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.environmentId} data-environment-id={group.environmentId}>
          <tr>
            <th
              scope="colgroup"
              colSpan={6}
              className="truncate px-4 pb-1 pt-3 text-left text-[12px] font-medium text-foreground/80"
            >
              {group.projectName} › <span className="font-mono">{group.environmentName}</span>
              {/* SVC-11 */}
              {group.checked ? null : (
                <span className="ml-2 font-normal text-muted-foreground">
                  not checked (other host)
                </span>
              )}
            </th>
          </tr>
          {group.services.map((service) => (
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
        </tbody>
      ))}
    </table>
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
  stop: "none" | "stopping" | "force";
  onSelect: (service: Service) => void;
  onOpenThread: (threadId: string) => void;
  onStop: (service: Service) => void;
  onForceStop: (service: Service) => void;
}) {
  const cell = "px-2 py-1.5 align-middle";
  const ports = service.ports.map((port) => `:${port}`).join(" ");
  return (
    <tr
      data-service-pid={service.pid}
      data-selected={selected ? "" : undefined}
      onClick={() => onSelect(service)}
      className={cn(
        "cursor-default border-l-2",
        selected
          ? "border-l-foreground/60 bg-foreground/[0.07]"
          : "border-l-transparent hover:bg-foreground/[0.04]",
      )}
    >
      <td className={cn(cell, "truncate pl-[14px] font-mono tabular-nums")} title={ports}>
        {ports}
      </td>
      <td className={cell}>
        <button
          type="button"
          aria-current={selected ? "true" : undefined}
          title={service.command}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(service);
          }}
          className="block w-full min-w-0 truncate rounded-sm text-left font-mono text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {service.command}
        </button>
      </td>
      <td className={cell}>
        {service.threadId && service.threadTitle !== null ? (
          <button
            type="button"
            title={`Open ${service.threadTitle}`}
            onClick={(event) => {
              event.stopPropagation();
              if (service.threadId) onOpenThread(service.threadId);
            }}
            className="block max-w-full truncate rounded-sm text-left text-foreground/80 underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
          >
            {service.threadTitle}
          </button>
        ) : null}
      </td>
      <td className={cn(cell, "font-mono tabular-nums text-muted-foreground")}>{service.pid}</td>
      <td className={cn(cell, "tabular-nums text-muted-foreground")}>
        {formatAgo(service.startedAt, now)}
      </td>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: only keeps clicks on the actions from selecting the row. */}
      <td className={cn(cell, "pr-3")} onClick={(event) => event.stopPropagation()}>
        <span className="flex items-center justify-end gap-0.5">
          <OpenAction service={service} />
          <CopyAction service={service} />
          {stop === "force" ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px] text-destructive pointer-coarse:h-9"
              onClick={() => onForceStop(service)}
            >
              Force stop
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className={ACTION_BUTTON_CLASS}
              aria-label={stop === "stopping" ? "Stopping…" : `Stop ${service.command}`}
              disabled={stop === "stopping"}
              onClick={() => onStop(service)}
            >
              <Icon name="Square" aria-hidden="true" />
            </Button>
          )}
        </span>
      </td>
    </tr>
  );
}

/** SVC-6: open a port in a new browser tab; a menu when there are several. */
function OpenAction({ service }: { service: Service }) {
  const link =
    "flex items-center justify-center rounded-md outline-none hover:bg-foreground/6 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring";
  const [only] = service.ports;
  if (service.ports.length === 1 && only !== undefined) {
    return (
      <a
        href={serviceUrl(only)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open :${only} in a new tab`}
        title={serviceUrl(only)}
        className={cn(ACTION_BUTTON_CLASS, link)}
      >
        <Icon name="ExternalLink" className="size-3.5" aria-hidden="true" />
      </a>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={ACTION_BUTTON_CLASS}
          aria-label={`Open a port of ${service.command}`}
        >
          <Icon name="ExternalLink" aria-hidden="true" />
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

/** SVC-7: copy the PID, the command line, or a port. */
function CopyAction({ service }: { service: Service }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={ACTION_BUTTON_CLASS}
          aria-label={`Copy from ${service.command}`}
        >
          <Icon name="Copy" aria-hidden="true" />
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * SVC-5, SVC-16: the drawer along the bottom: the command line, the log's
 * path with a copy action, and its last 64 KB, kept scrolled to the end
 * unless scrolled up.
 */
function LogDrawer({
  service,
  ended,
  log,
  onClose,
}: {
  service: Service;
  ended: boolean;
  log: LogState;
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
      className="flex h-[40%] min-h-[160px] shrink-0 flex-col border-t border-foreground/8 bg-background"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-foreground/8 pl-4 pr-2 text-[12px]">
        <span className="min-w-0 max-w-[45%] shrink-0 truncate font-mono" title={service.command}>
          {service.command}
        </span>
        {path ? (
          <>
            <span className="text-muted-foreground">·</span>
            <span
              data-log-path=""
              className="min-w-0 flex-1 truncate font-mono text-muted-foreground"
              title={path}
            >
              {path}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1.5 px-2 text-[12px] text-muted-foreground [&_[data-icon-root]]:size-3.5"
              aria-label="Copy log path"
              onClick={() => void copy(path, "the log path")}
            >
              <Icon name="Copy" aria-hidden="true" />
              path
            </Button>
          </>
        ) : (
          <span className="flex-1" />
        )}
        <Button
          variant="ghost"
          size="icon"
          className={ACTION_BUTTON_CLASS}
          aria-label="Close log"
          onClick={onClose}
        >
          <Icon name="X" aria-hidden="true" />
        </Button>
      </div>
      {ended ? (
        <p
          role="status"
          className="shrink-0 border-b border-foreground/8 px-4 py-1.5 text-[12px] text-muted-foreground"
        >
          This process ended.
        </p>
      ) : null}
      {log.kind === "log" && log.error ? (
        <p role="alert" className="shrink-0 px-4 py-1.5 text-[12px] text-destructive">
          Could not read the log: {log.error}
        </p>
      ) : null}
      {log.kind === "none" ? (
        <p className="px-4 py-3 text-[12.5px] text-muted-foreground">
          This process has no log file: its standard output is not a file.
        </p>
      ) : log.kind === "loading" ? (
        <p className="px-4 py-3 text-[12.5px] text-muted-foreground">
          {ended ? "" : "Reading the log…"}
        </p>
      ) : (
        <pre
          ref={scroller}
          data-log=""
          onScroll={(event) => {
            const element = event.currentTarget;
            atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
          }}
          className="min-h-0 flex-1 overflow-auto whitespace-pre px-4 py-2 font-mono text-[12px] leading-[1.45] text-foreground/90 outline-none"
        >
          {text}
        </pre>
      )}
    </section>
  );
}
