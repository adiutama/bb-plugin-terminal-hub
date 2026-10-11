// Telling "bb says it does not exist" apart from "bb could not be reached".

/** bb reports a missing terminal as 404 `terminal_not_found`. */
export function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { status?: unknown; code?: unknown; message?: unknown };
  if (record.status === 404) return true;
  const text = `${String(record.code ?? "")} ${String(record.message ?? "")}`;
  return /not[\s_-]?found/i.test(text);
}
