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

/** A string shown on one line: line breaks become spaces. */
function line(value: unknown, max = Number.POSITIVE_INFINITY): string | null {
  const found = text(value);
  if (found === null) return null;
  const flat = found.replace(/\s*[\r\n]+\s*/g, " ").trim();
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
    case: text(data.case)?.trim().slice(0, CASE_MAX) || null,
    credentials: each(data.credentials, (item) => {
      const label = line(item.label);
      if (label === null) return null;
      return { label, username: text(item.username), secret: text(item.secret) };
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
          const url = text(entry.url);
          return label === null || url === null ? null : { label, url };
        }),
      };
    }),
  };
}

/**
 * SVC-27: reads the record at `path` only when it is an absolute path to a
 * regular file, not a symlink, owned by this server's user, of at most
 * 64 KiB; null when it is unreadable for any reason.
 */
export async function readRecord(host: ProcessHost, path: string): Promise<ServiceRecord | null> {
  if (!path.startsWith("/") || host.uid === null) return null;
  let file: Awaited<ReturnType<ProcessHost["readRegularFile"]>>;
  try {
    file = await host.readRegularFile(path, RECORD_MAX_BYTES);
  } catch {
    return null;
  }
  if (file.kind !== "file" || file.uid !== host.uid) return null;
  if (file.size > RECORD_MAX_BYTES || file.text === null) return null;
  return parseRecord(file.text);
}
