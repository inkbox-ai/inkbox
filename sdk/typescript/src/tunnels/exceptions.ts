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

export class TunnelRemoved extends TunnelError {
  constructor(message: string) {
    super(message);
    this.name = "TunnelRemoved";
  }
}

export class TunnelStateConflict extends InkboxAPIError {
  constructor(statusCode: number, detail: InkboxAPIErrorDetail) {
    super(statusCode, detail);
    this.name = "TunnelStateConflict";
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

/**
 * Raised by `connect()` when no tunnel exists for the supplied name in
 * the calling org. Tunnels are provisioned atomically as part of
 * `inkbox.createIdentity(...)`; they have no standalone create surface.
 */
export class TunnelNotProvisioned extends TunnelError {
  constructor(message: string) {
    super(message);
    this.name = "TunnelNotProvisioned";
  }
}
