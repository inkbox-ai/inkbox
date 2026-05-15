/**
 * inkbox-tunnels/_validation.ts
 *
 * Local handle / tunnel-name validation. Mirrors the server's canonical
 * validator (`~/servers/src/data_models/api_contracts/tunnel.py`).
 * Handle and tunnel-name share a single global namespace; the same
 * rules apply to both. `validateAgentHandle` is an alias for callers
 * who think of the value as a handle.
 */

import { TunnelNameInvalid } from "./exceptions.js";
import { isReservedName } from "./_reserved_names.js";

const MIN_LENGTH = 3;
const MAX_LENGTH = 63;

const TUNNEL_NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$|^[a-z0-9]$/;

/**
 * Normalize a raw handle / tunnel-name: strip a leading `@`, lowercase.
 * Returns the normalized value; subsequent validation runs against it.
 */
export function normalizeAgentHandle(value: string): string {
  if (typeof value !== "string") {
    throw new TunnelNameInvalid("agent_handle / tunnel_name must be a string");
  }
  let s = value;
  if (s.startsWith("@")) s = s.slice(1);
  return s.toLowerCase();
}

export function validateTunnelName(name: string): string {
  const normalized = normalizeAgentHandle(name);
  if (normalized.length < MIN_LENGTH) {
    throw new TunnelNameInvalid(
      `tunnel_name must be at least ${MIN_LENGTH} characters`,
    );
  }
  if (normalized.length > MAX_LENGTH) {
    throw new TunnelNameInvalid(
      `tunnel_name must be at most ${MAX_LENGTH} characters`,
    );
  }
  if (!TUNNEL_NAME_RE.test(normalized)) {
    throw new TunnelNameInvalid(
      "tunnel_name may only contain lowercase letters, numbers, and " +
        "hyphens, must start and end with a letter or number, and must " +
        "not contain consecutive hyphens",
    );
  }
  if (isReservedName(normalized)) {
    throw new TunnelNameInvalid(`tunnel_name '${normalized}' is reserved`);
  }
  return normalized;
}

/**
 * Alias of {@link validateTunnelName}. Handle and tunnel-name share a
 * global namespace and the same validator; this just lets callers spell
 * the intent.
 */
export const validateAgentHandle = validateTunnelName;
