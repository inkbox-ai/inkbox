/**
 * inkbox-identities/exceptions.ts
 *
 * Typed exceptions for the identities surface.
 */

import { InkboxAPIError, type InkboxAPIErrorDetail } from "../_http.js";

/** Which namespace blocked the handle on a 409 from creation. */
export type BlockingNamespace = "identities" | "tunnels" | "mail" | null;

/**
 * Raised by `identities.create()` or `inkbox.createIdentity()` when the
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
 * Read `blocking_namespace` from an identity-creation error detail.
 * Returns `null` when the field is absent or unrecognized.
 */
export function readBlockingNamespace(detail: InkboxAPIErrorDetail): BlockingNamespace {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const v = (detail as Record<string, unknown>)["blocking_namespace"];
    if (v === "identities" || v === "tunnels" || v === "mail") return v;
  }
  return null;
}

/**
 * If `err` is a 409 handle collision from identity creation,
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
    const mapped = new HandleUnavailableError(
      err.statusCode,
      err.detail,
      readBlockingNamespace(err.detail),
    );
    mapped.agentSupport = err.agentSupport;
    return mapped;
  }
  return err;
}
