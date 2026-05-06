/**
 * inkbox-tunnels/_validation.ts
 *
 * Local tunnel-name validation. Mirrors the server's `_validate_tunnel_name`.
 */

import { TunnelNameInvalid } from "./exceptions.js";

const MIN_LENGTH = 3;
const MAX_LENGTH = 63;

const TUNNEL_NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$|^[a-z0-9]$/;

export function validateTunnelName(name: string): string {
  if (typeof name !== "string") {
    throw new TunnelNameInvalid("tunnel_name must be a string");
  }
  if (name.length < MIN_LENGTH) {
    throw new TunnelNameInvalid(
      `tunnel_name must be at least ${MIN_LENGTH} characters`,
    );
  }
  if (name.length > MAX_LENGTH) {
    throw new TunnelNameInvalid(
      `tunnel_name must be at most ${MAX_LENGTH} characters`,
    );
  }
  if (!TUNNEL_NAME_RE.test(name)) {
    throw new TunnelNameInvalid(
      "tunnel_name may only contain lowercase letters, numbers, and " +
        "hyphens, must start and end with a letter or number, and must " +
        "not contain consecutive hyphens",
    );
  }
  return name;
}
