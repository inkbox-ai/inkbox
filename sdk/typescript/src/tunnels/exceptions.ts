/**
 * inkbox-tunnels/exceptions.ts
 *
 * Typed exceptions for the Tunnels SDK surface.
 */

import {
  InkboxAPIError,
  InkboxError,
  type InkboxAPIErrorDetail,
} from "../_http.js";

export class TunnelError extends InkboxError {
  constructor(message: string) {
    super(message);
    this.name = "TunnelError";
  }
}

export class TunnelNameInvalid extends TunnelError {
  constructor(message: string) {
    super(message);
    this.name = "TunnelNameInvalid";
  }
}

export class TunnelSecretUnavailable extends TunnelError {
  constructor(message: string) {
    super(message);
    this.name = "TunnelSecretUnavailable";
  }
}

export class TunnelRemoved extends TunnelError {
  constructor(message: string) {
    super(message);
    this.name = "TunnelRemoved";
  }
}

function sanitizeDetail(detail: InkboxAPIErrorDetail): InkboxAPIErrorDetail {
  const sanitizeStr = (s: string): string =>
    s.replace(/delete_pending/g, "pending_removal").replace(/deleted/g, "removed");
  if (typeof detail === "string") return sanitizeStr(detail);
  if (detail && typeof detail === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(detail)) {
      out[k] = typeof v === "string" ? sanitizeStr(v) : v;
    }
    return out;
  }
  return detail;
}

export class TunnelStateConflict extends InkboxAPIError {
  constructor(statusCode: number, detail: InkboxAPIErrorDetail) {
    super(statusCode, sanitizeDetail(detail));
    this.name = "TunnelStateConflict";
  }
}

export class TunnelNameUnavailable extends InkboxAPIError {
  constructor(statusCode: number, detail: InkboxAPIErrorDetail) {
    super(statusCode, detail);
    this.name = "TunnelNameUnavailable";
  }
}

export class TunnelTLSModeMismatch extends InkboxAPIError {
  constructor(statusCode: number, detail: InkboxAPIErrorDetail) {
    super(statusCode, detail);
    this.name = "TunnelTLSModeMismatch";
  }
}

export class TunnelCSRStateConflict extends TunnelStateConflict {
  constructor(statusCode: number, detail: InkboxAPIErrorDetail) {
    super(statusCode, detail);
    this.name = "TunnelCSRStateConflict";
  }
}
