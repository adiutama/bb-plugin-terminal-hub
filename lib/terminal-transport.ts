// The pump's I/O, straight over bb's terminals API (`useSdk().terminals`).
//
// Floating Ghostty routed these through its own server RPC; the hub has no
// server state to consult, so the page calls bb directly.

/** Cap on the scrollback replayed when a view attaches to a session (VIEW-2). */
export const REPLAY_TAIL_BYTES = 256_000;

export interface ReadResult {
  chunks: { dataBase64: string }[];
  nextSeq: number;
  /** True when the ring buffer dropped bytes before `sinceSeq`. */
  truncated: boolean;
  status: string | null;
  exitCode: number | null;
}

export interface TerminalTransport {
  /** Output after `sinceSeq`; with `replay`, the retained tail instead. */
  read(args: { sinceSeq: number; replay: boolean }): Promise<ReadResult>;
  write(dataBase64: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
}

export interface TransportSdk {
  terminals: {
    output(args: { terminalId: string; sinceSeq?: number; tailBytes?: number }): Promise<{
      chunks: { dataBase64: string }[];
      nextSeq: number;
      truncated: boolean;
      status: string;
      exitCode: number | null;
    }>;
    get(args: { terminalId: string }): Promise<{ status: string; exitCode: number | null }>;
    input(args: { terminalId: string; dataBase64: string }): Promise<unknown>;
    resize(args: { terminalId: string; cols: number; rows: number }): Promise<unknown>;
  };
}

function isLive(status: string): boolean {
  return status === "running" || status === "starting";
}

export function createTerminalTransport(sdk: TransportSdk, terminalId: string): TerminalTransport {
  return {
    async read({ sinceSeq, replay }) {
      try {
        const output = await sdk.terminals.output({
          terminalId,
          ...(replay ? { tailBytes: REPLAY_TAIL_BYTES } : { sinceSeq }),
        });
        return {
          chunks: output.chunks,
          nextSeq: output.nextSeq,
          truncated: output.truncated,
          status: output.status,
          exitCode: output.exitCode,
        };
      } catch (error) {
        // bb may reject output reads after the process exits. Ask for the
        // lifecycle state so the view can show the exit code, without
        // mistaking a network error for an exit.
        let session: { status: string; exitCode: number | null } | null = null;
        try {
          session = await sdk.terminals.get({ terminalId });
        } catch {
          // No authoritative exit state: report the original failure.
        }
        if (session && !isLive(session.status)) {
          return {
            chunks: [],
            nextSeq: sinceSeq,
            truncated: false,
            status: session.status,
            exitCode: session.exitCode,
          };
        }
        throw error;
      }
    },
    async write(dataBase64) {
      await sdk.terminals.input({ terminalId, dataBase64 });
    },
    async resize(cols, rows) {
      await sdk.terminals.resize({ terminalId, cols, rows });
    },
  };
}
