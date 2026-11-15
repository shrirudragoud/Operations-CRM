// Maps database errors to messages people can act on (docs/ARCHITECTURE.md "Data access rules").
// Business-rule errors raised by our triggers/RPCs (RAISE EXCEPTION) are written for humans, so they
// are shown as-is. Everything else becomes a generic message and the detail is logged server-side.

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type DbError = { code?: string; message: string; details?: string | null; hint?: string | null };

export const GENERIC_ERROR = "Something went wrong. Please try again; if it keeps happening, tell the founder.";
export const PERMISSION_ERROR = "You don't have permission to do that.";

export function dbErrorMessage(error: DbError): string {
  const code = error.code ?? "";
  const message = error.message ?? "";

  // RLS rejections carry table names; translate them.
  if (/row-level security/i.test(message)) return PERMISSION_ERROR;
  // P0001 = RAISE EXCEPTION without a code: our rule messages. 42501 is used by our RPCs for
  // "Only the founder can ..." (and by Postgres for missing grants, which mention "permission denied").
  if (code === "P0001") return message;
  if (code === "42501") return /^permission denied/i.test(message) ? PERMISSION_ERROR : message;
  if (code === "23505") return "That already exists. Check for a duplicate.";
  if (code === "23503") return "That record is linked to other records, so it can't be changed this way.";
  if (code === "23514" || code === "23502") return "Some values are not allowed. Check the form and try again.";
  if (code === "PGRST116") return "Not found, or you don't have access to it.";
  if (code === "PGRST301" || code === "PGRST303") return "Your session has expired. Sign in again.";
  return GENERIC_ERROR;
}

/** Turn a DB error into a failed ActionResult, logging the detail for unexpected errors. */
export function fail(error: DbError, context: string): { ok: false; error: string } {
  const text = dbErrorMessage(error);
  if (text === GENERIC_ERROR) {
    console.error(JSON.stringify({ level: "error", context, code: error.code, message: error.message, details: error.details }));
  }
  return { ok: false, error: text };
}
