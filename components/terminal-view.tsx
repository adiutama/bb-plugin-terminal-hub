// The selected terminal, live: a div a TerminalPump owns, plus find and status.
//
// Only the selected terminal is mounted. Selecting another one or leaving the
// page unmounts this view and its pump stops polling; hiding the browser tab
// pauses it (VIEW-3).
import { useEffect, useRef, useState } from "react";
import { FindBar } from "@/components/find-bar";
import { isolateTerminalKey } from "@/lib/keyboard";
import { TerminalPump, type ViewStatus } from "@/lib/pump";
import { createTerminalTransport, type TransportSdk } from "@/lib/terminal-transport";
import { BB_TERMINAL_FONT_SIZE } from "@/lib/theme";

export interface TerminalViewProps {
  sdk: TransportSdk;
  terminalId: string;
  /** The shell's own size as bb last reported it. */
  cols: number;
  rows: number;
  /** A shell the hub just created or restarted: answer its startup queries. */
  fresh?: boolean;
  onOutput?: (terminalId: string, bytes: Uint8Array) => void;
  onStatus?: (terminalId: string, status: ViewStatus, detail: string | null) => void;
  /** VIEW-7: the session ended, so the list can mark its row at once. */
  onExit?: (
    terminalId: string,
    status: "exited" | "gone",
    exitCode: number | null,
    typedAgoMs: number | null,
  ) => void;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function TerminalView({
  sdk,
  terminalId,
  cols,
  rows,
  fresh = false,
  onOutput,
  onStatus,
  onExit,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pumpRef = useRef<TerminalPump | null>(null);
  const visible = usePageVisible();
  const [status, setStatus] = useState<{ status: ViewStatus; detail: string | null }>({
    status: "connecting",
    detail: null,
  });
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ index: number; count: number } | null>(null);

  // Callbacks live in a ref so the pump effect depends only on the terminal
  // and never tears down a live view because a parent re-rendered.
  const handlers = useRef({ onOutput, onStatus, onExit });
  handlers.current = { onOutput, onStatus, onExit };
  const initial = useRef({ cols, rows, fresh, visible });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const start = initial.current;
    const pump = new TerminalPump({
      container,
      transport: createTerminalTransport(sdk, terminalId),
      fontSize: BB_TERMINAL_FONT_SIZE,
      size: { cols: start.cols, rows: start.rows },
      answerQueries: start.fresh,
      focusOnReady: start.fresh,
      onStatus: (next, detail) => {
        setStatus({ status: next, detail });
        handlers.current.onStatus?.(terminalId, next, detail);
      },
      onExit: (status, exitCode, typedAgoMs) =>
        handlers.current.onExit?.(terminalId, status, exitCode, typedAgoMs),
      onOutput: (bytes) => handlers.current.onOutput?.(terminalId, bytes),
      onFindRequested: () => setFinding(true),
      onSearchResults: setResults,
    });
    pumpRef.current = pump;
    // Let layout settle before the first fit, then replay and start polling.
    const frame = window.requestAnimationFrame(() => {
      pump.setVisible(start.visible);
      pump.fit();
      pump.start();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      pumpRef.current = null;
      pump.dispose();
    };
  }, [sdk, terminalId]);

  useEffect(() => {
    pumpRef.current?.setVisible(visible);
  }, [visible]);

  useEffect(() => {
    pumpRef.current?.setSessionSize(cols, rows);
  }, [cols, rows]);

  const closeFind = () => {
    setFinding(false);
    setResults(null);
    pumpRef.current?.clearSearch();
    pumpRef.current?.setFocused(true);
  };

  return (
    <div className="th-terminal relative size-full min-h-0 overflow-hidden bg-background">
      {/* Wterm owns this node's classes and children; keep React's state on
          the wrapper so re-renders cannot erase the renderer's styles. Key
          handlers run after the shell has the key and keep it from bb's
          global shortcuts. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Wterm's own textarea takes the input; these handlers only stop keys bubbling to bb. */}
      <div
        ref={containerRef}
        className="size-full"
        onKeyDown={isolateTerminalKey}
        onKeyUp={isolateTerminalKey}
      />
      {finding ? (
        <FindBar
          query={query}
          results={results}
          onQueryChange={(next) => {
            setQuery(next);
            if (next === "") pumpRef.current?.clearSearch();
            else pumpRef.current?.findNext(next, true);
          }}
          onNext={() => pumpRef.current?.findNext(query)}
          onPrevious={() => pumpRef.current?.findPrevious(query)}
          onClose={closeFind}
        />
      ) : null}
      {status.status === "exited" || status.status === "error" ? (
        <div
          role="status"
          className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground shadow"
        >
          <span
            className={status.status === "exited" ? "text-muted-foreground" : "text-destructive"}
          >
            {status.detail ?? (status.status === "exited" ? "Exited" : "Connection problem")}
          </span>
        </div>
      ) : null}
    </div>
  );
}
