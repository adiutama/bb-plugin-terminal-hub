// LIST-7: a local server address in recent output, shown on the row.

/** How much recent output the hint is read from. */
export const HINT_TAIL_BYTES = 4096;

// CSI, OSC (BEL or ST terminated), and single-character escapes.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?[^\s'"<>)]*/g;
const LOCAL_LINE = /Local:\s+(https?:\/\/[^\s'"<>)]+)/g;

export interface ServerHint {
  url: string;
  /** `:3000`, or the host when the URL names no port. */
  label: string;
}

/** The last local server address in `text`, or null. */
export function findServerHint(text: string): ServerHint | null {
  const plain = text.replace(ANSI, "");
  let best: { url: string; at: number } | null = null;
  for (const match of plain.matchAll(LOCAL_URL)) {
    if (best === null || match.index >= best.at) best = { url: match[0], at: match.index };
  }
  for (const match of plain.matchAll(LOCAL_LINE)) {
    const at = match.index + match[0].length - (match[1]?.length ?? 0);
    if (match[1] && (best === null || at >= best.at)) best = { url: match[1], at };
  }
  if (best === null) return null;
  const url = best.url.replace(/[.,;:]+$/, "");
  try {
    const parsed = new URL(url);
    return { url, label: parsed.port ? `:${parsed.port}` : parsed.hostname };
  } catch {
    return null;
  }
}

/** A rolling tail of a terminal's output, for re-reading the hint while viewed. */
export class OutputTail {
  private bytes = new Uint8Array(0);
  private readonly decoder = new TextDecoder();

  push(chunk: Uint8Array): void {
    const joined = new Uint8Array(this.bytes.length + chunk.length);
    joined.set(this.bytes);
    joined.set(chunk, this.bytes.length);
    this.bytes = joined.slice(Math.max(0, joined.length - HINT_TAIL_BYTES));
  }

  text(): string {
    return this.decoder.decode(this.bytes);
  }
}
