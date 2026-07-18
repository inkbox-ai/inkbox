/**
 * inkbox-identities/exceptions.ts
 *
 * Typed exceptions for the identities surface.
 */

import { InkboxAPIError, type InkboxAPIErrorDetail } from "../_http.js";

/** Which namespace blocked the handle on a 409 from create / rename. */
export type BlockingNamespace = "identities" | "tunnels" | "mail" | null;

/**
 * Raised by `identities.create()` / `identities.update()` (and the
 * `inkbox.createIdentity` / `identity.update` wrappers) when the
 * requested agent_handle collides with the global handle namespace.
 *
 * The unified namespace check runs across identities, tunnels, and the
 * platform-mailbox local part; `blockingNamespace` reports which side
 * rejected so callers can render an appropriate message.
 */
export class HandleUnavailableError extends InkboxAPIError {
  readonly blockingNamespace: BlockingNamespace;

  constructor(
    statusCode: number,
    detail: InkboxAPIErrorDetail,
    blockingNamespace: BlockingNamespace,
  ) {
    super(statusCode, detail);
    this.name = "HandleUnavailableError";
    this.blockingNamespace = blockingNamespace;
  }
}

/**
 * Inspect a 409 error detail for a `blocking_namespace` field. Returns
 * the parsed value when present, else `null`. (Servers running 1.0+ set
 * this on every `agent_handle_unavailable` 409 from identity-create or
 * identity-rename.)
 */
export function readBlockingNamespace(detail: InkboxAPIErrorDetail): BlockingNamespace {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const v = (detail as Record<string, unknown>)["blocking_namespace"];
    if (v === "identities" || v === "tunnels" || v === "mail") return v;
  }
  return null;
}

/**
 * If `err` is a 409 collision error from the identities endpoints,
 * return a `HandleUnavailableError`; otherwise return the original
 * error untouched so it propagates as-is.
 */
export function mapIdentityConflictError(err: InkboxAPIError): Error {
  const detail = err.detail;
  const discriminator =
    detail && typeof detail === "object" && !Array.isArray(detail)
      ? String(
          (detail as Record<string, unknown>)["code"]
          ?? (detail as Record<string, unknown>)["error"]
          ?? "",
        )
      : "";
  if (err.statusCode === 409 && discriminator === "agent_handle_unavailable") {
    return new HandleUnavailableError(
      err.statusCode,
      err.detail,
      readBlockingNamespace(err.detail),
    );
  }
  return err;
}
