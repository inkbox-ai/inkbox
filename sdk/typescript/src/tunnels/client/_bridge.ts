/**
 * inkbox-tunnels/client/_bridge.ts
 *
 * Per-bridge state + close-code mapping for passthrough TCP streams.
 * Mirrors Python `_bridge.py`. The actual pump loops live in
 * `_runtime.ts` (they need access to the h2 session, send-locking, and
 * stream events).
 */

export const BRIDGE_STATUS_TIMEOUT_MS = 10_000;
export const BRIDGE_HALF_CLOSE_GRACE_MS = 5_000;
export const BRIDGE_CLEANUP_SEND_TIMEOUT_MS = 1_000;

export const BRIDGE_CLOSE_CODE: Readonly<Record<string, number>> = {
  "clean-eof": 1000,
  "protocol-error": 1002,
  "inbound-error": 1011,
  "outbound-error": 1011,
  "tls-error": 1011,
  cancelled: 1001,
};

export interface BridgeStats {
  tcpId: string;
  streamId: number;
  sniHost: string;
  inboundFrames: number;
  outboundFrames: number;
  decryptedBytes: number;
  encryptedBytes: number;
  continuationFrames: number;
  tlsHandshakeDone: boolean;
  closeReason: string;
}

export class BridgeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeProtocolError";
  }
}

export class BridgeOpenFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeOpenFailed";
  }
}

export class BridgeStreamReset extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeStreamReset";
  }
}

export function makeBridgeStats(
  tcpId: string,
  streamId: number,
  sniHost: string,
): BridgeStats {
  return {
    tcpId,
    streamId,
    sniHost,
    inboundFrames: 0,
    outboundFrames: 0,
    decryptedBytes: 0,
    encryptedBytes: 0,
    continuationFrames: 0,
    tlsHandshakeDone: false,
    closeReason: "",
  };
}
