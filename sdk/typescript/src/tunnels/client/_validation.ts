/**
 * inkbox-tunnels/client/_validation.ts
 *
 * Path-traversal + forward-target validation for the data-plane runtime.
 * Mirrors the Python ``_url_forward.py`` algorithms so the two SDKs
 * accept and reject the same set of inputs.
 */

const LOOPBACK_LITERALS = new Set(["localhost", "127.0.0.1", "::1"]);

export class ForwardTargetRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForwardTargetRefused";
  }
}

/**
 * Validate `forward_to` against the loopback-only allowlist.
 *
 * Default refuses any host that isn't a literal loopback form. Hostnames
 * that *would* resolve to loopback are also refused (no DNS resolution
 * happens here — that lets a rebinding-prone hostname slip a sensitive
 * target past the check).
 */
export function validateForwardTarget(
  forwardTo: string,
  options: { allowRemoteForwarding?: boolean } = {},
): void {
  if (options.allowRemoteForwarding === true) return;
  let parsed: URL;
  try {
    parsed = new URL(forwardTo);
  } catch {
    throw new ForwardTargetRefused(`forward_to is not a valid URL: ${forwardTo}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ForwardTargetRefused(
      `forward_to scheme must be http or https; got ${parsed.protocol}`,
    );
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!host) {
    throw new ForwardTargetRefused(`forward_to has no host: ${forwardTo}`);
  }
  if (LOOPBACK_LITERALS.has(host)) return;
  // IPv4 in 127.0.0.0/8?
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    if (a === 127) return;
    throw new ForwardTargetRefused(
      `forward_to address ${host} is not loopback; pass ` +
        "allowRemoteForwarding: true to bypass (review the SSRF tradeoff first)",
    );
  }
  // ::1 already covered by the literals set; otherwise fall through.
  throw new ForwardTargetRefused(
    `forward_to host ${host} is not a literal loopback address; pass ` +
      "allowRemoteForwarding: true to bypass (review the SSRF tradeoff first)",
  );
}

/**
 * Reject path-traversal evasion attempts. Returns `null` on success or
 * the `inkbox-reason` string for the rejection.
 */
export function validateEnvelopePath(path: string): string | null {
  const queryIdx = path.indexOf("?");
  const rawPath = queryIdx >= 0 ? path.slice(0, queryIdx) : path;
  const lowered = rawPath.toLowerCase();
  if (lowered.includes("%2f") || lowered.includes("%5c")) return "invalid-path";
  let decoded: string;
  try {
    const pass1 = decodeURIComponent(rawPath);
    if (pass1 !== rawPath) {
      const pass2 = decodeURIComponent(pass1);
      if (pass2 !== pass1) return "invalid-path";
      decoded = pass2;
    } else {
      decoded = pass1;
    }
  } catch {
    return "invalid-path";
  }
  for (const segment of decoded.split("/")) {
    if (segment === "." || segment === "..") return "invalid-path";
    // Some upstream frameworks treat raw backslash as a path separator.
    // Reject it so `/static\..\secret` can't slip past split-on-/.
    if (segment.includes("\\")) return "invalid-path";
    for (const ch of segment) {
      const o = ch.charCodeAt(0);
      if (o < 0x20 || o === 0x7f) return "invalid-path";
    }
  }
  return null;
}
