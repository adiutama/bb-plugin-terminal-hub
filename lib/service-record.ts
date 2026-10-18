// The agent service record, version 1 (ADR 202610180513): the `services.json`
// a process's `AGENT_SERVICE_RECORD` names. Read on the server entry only,
// through the ProcessHost, and only ever shown: nothing in it decides what is
// listed, which log is read, or what is signalled (SVC-30).
import type { ProcessHost } from "./processes";

/** SVC-27: the largest record read. */
export const RECORD_MAX_BYTES = 64 * 1024;

const SERVICE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TITLE_MAX = 200;
const CASE_MAX = 2000;

export interface RecordUrl {
  label: string;
  url: string;
}

export interface RecordCredential {
  label: string;
  username: string | null;
  secret: string | null;
}

export interface RecordService {
  name: string;
  urls: RecordUrl[];
}

/** What Terminal Hub shows of a readable record. */
export interface ServiceRecord {
  id: string | null;
  title: string | null;
  case: string | null;
  credentials: RecordCredential[];
  services: RecordService[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An optional string; anything else is ignored (SVC-27). */
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * SVC-29: C0 and C1 control characters (a terminal's escape sequences) and
 * Unicode bidirectional controls, which could restyle a terminal or reorder
 * what is shown.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** SVC-29: a record string as plain text, on one line: line breaks and tabs become spaces. */
function line(value: unknown, max = Number.POSITIVE_INFINITY): string | null {
  const found = text(value);
  if (found === null) return null;
  const flat = found.replace(/\s+/g, " ").replace(CONTROLS, "").trim();
  return flat === "" ? null : flat.slice(0, max);
}

/** The array's items that `read` accepts; a non-array is ignored. */
function each<T>(value: unknown, read: (item: Json) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const found = isObject(item) ? read(item) : null;
    return found === null ? [] : [found];
  });
}

/**
 * SVC-27: the record in `source`, or null when it is unreadable: not JSON,
 * not an object, or without `version` 1 and a `services` array. Fields of the
 * wrong type, entries missing a required field, and unknown fields are
 * ignored one by one.
 */
export function parseRecord(source: string): ServiceRecord | null {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isObject(data) || data.version !== 1 || !Array.isArray(data.services)) return null;
  const names = new Set<string>();
  return {
    id: line(data.id),
    title: line(data.title, TITLE_MAX),
    case: line(data.case, CASE_MAX),
    credentials: each(data.credentials, (item) => {
      const label = line(item.label);
      if (label === null) return null;
      // The secret stays whole: it is masked, and copying gives it as written.
      return { label, username: line(item.username), secret: text(item.secret) };
    }),
    services: each(data.services, (item) => {
      const name = text(item.name);
      // Names are unique: a second entry with a name already seen is ignored.
      if (name === null || !SERVICE_NAME.test(name) || names.has(name)) return null;
      names.add(name);
      return {
        name,
        urls: each(item.urls, (entry) => {
          const label = line(entry.label);
          const url = line(entry.url);
          return label === null || url === null ? null : { label, url };
        }),
      };
    }),
  };
}

/** SVC-27: how long a record may take to read before it counts as unreadable. */
export const RECORD_TIMEOUT_MS = 1_000;

/**
 * SVC-27: reads the record at `path` only when it is an absolute path to a
 * regular file, not a symlink, owned by this server's user, of at most
 * 64 KiB; null when it is unreadable for any reason. `lstat` comes first, so
 * nothing but a regular file (never a device) is opened, and the file opened
 * must be the one `lstat` saw. A read that takes longer than `timeoutMs`
 * (a hung network mount) counts as unreadable.
 */
export async function readRecord(
  host: ProcessHost,
  path: string,
  timeoutMs = RECORD_TIMEOUT_MS,
): Promise<ServiceRecord | null> {
  if (!path.startsWith("/") || host.uid === null) return null;
  const uid = host.uid;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const read = (async () => {
    const seen = await host.lstat(path);
    if (seen.kind !== "file" || seen.uid !== uid || seen.size > RECORD_MAX_BYTES) return null;
    const file = await host.readOpened(path, RECORD_MAX_BYTES);
    if (file.kind !== "file" || file.dev !== seen.dev || file.ino !== seen.ino) return null;
    if (file.uid !== uid || file.size > RECORD_MAX_BYTES || file.text === null) return null;
    return parseRecord(file.text);
  })().catch(() => null);
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}
