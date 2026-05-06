/**
 * inkbox-tunnels/client/_state.ts
 *
 * Hardened on-disk persistence for the tunnel state file (Node-only).
 *
 * The directory layout matches the Python SDK so the two implementations
 * are interoperable on disk:
 *
 *     {state_dir}/
 *       state.json         # mode 0o600
 *       private_key.pem    # passthrough only, mode 0o600
 *       cert_chain.pem     # passthrough only, mode 0o600
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const STATE_FILE = "state.json";
export const KEY_FILE = "private_key.pem";
export const CERT_FILE = "cert_chain.pem";

export class TunnelStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TunnelStateError";
  }
}

export interface StateEntry {
  tunnelId: string;
  name: string;
  secret?: string | null;
  mode?: string | null;
  zone?: string | null;
  publicHost?: string | null;
}

interface RawStateEntry {
  tunnel_id?: string;
  name?: string;
  secret?: string | null;
  mode?: string | null;
  zone?: string | null;
  public_host?: string | null;
}

export function ensurePrivateStateDir(stateDir: string): void {
  let exists = false;
  let st: fs.Stats | null = null;
  try {
    st = fs.lstatSync(stateDir);
    exists = true;
  } catch {
    /* missing — fine */
  }
  if (st && st.isSymbolicLink()) {
    throw new TunnelStateError(
      `refusing to use a symlinked state_dir (${stateDir}); resolve and pass the real path`,
    );
  }
  if (!exists) {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(stateDir, 0o700);
  } catch {
    /* best effort */
  }
}

export function loadState(stateDir: string): StateEntry | null {
  const target = path.join(stateDir, STATE_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(target, "utf-8");
  } catch {
    return null;
  }
  let parsed: RawStateEntry;
  try {
    parsed = JSON.parse(raw) as RawStateEntry;
  } catch {
    return null;
  }
  return {
    tunnelId: String(parsed.tunnel_id ?? ""),
    name: String(parsed.name ?? ""),
    secret: parsed.secret ?? null,
    mode: parsed.mode ?? null,
    zone: parsed.zone ?? null,
    publicHost: parsed.public_host ?? null,
  };
}

export function saveState(stateDir: string, entry: StateEntry): void {
  ensurePrivateStateDir(stateDir);
  const target = path.join(stateDir, STATE_FILE);
  const raw: RawStateEntry = {
    tunnel_id: entry.tunnelId,
    name: entry.name,
  };
  if (entry.secret != null) raw.secret = entry.secret;
  if (entry.mode != null) raw.mode = entry.mode;
  if (entry.zone != null) raw.zone = entry.zone;
  if (entry.publicHost != null) raw.public_host = entry.publicHost;
  atomicWrite(target, JSON.stringify(raw, null, 2));
}

export function writePrivateFile(target: string, content: Buffer | string): void {
  let exists = false;
  try {
    fs.lstatSync(target);
    exists = true;
  } catch {
    /* missing — fine */
  }
  if (!exists) {
    const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY |
      (fs.constants.O_NOFOLLOW ?? 0);
    const fd = fs.openSync(target, flags, 0o600);
    try {
      const buf = typeof content === "string" ? Buffer.from(content) : content;
      fs.writeSync(fd, buf);
    } finally {
      fs.closeSync(fd);
    }
    return;
  }
  atomicWrite(target, content);
}

function atomicWrite(target: string, content: Buffer | string): void {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  try {
    fs.renameSync(tmp, target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      /* best effort */
    }
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* swallow */
    }
    throw err;
  }
}

/**
 * One-time disclosure of the connect secret.
 *
 * TTY-gated by default: prints to stderr only when stderr is a TTY.
 * Container/daemon/CI runs get only the breadcrumb pointing at the
 * on-disk state file.
 */
export function printSecretOnce(opts: {
  secret: string;
  statePath: string;
  printToStderr: boolean | null;
}): void {
  let shouldPrint = opts.printToStderr;
  if (shouldPrint === null || shouldPrint === undefined) {
    shouldPrint = Boolean(process.stderr.isTTY);
  }
  if (!shouldPrint) return;
  const banner =
    "\n" +
    "=================================================================\n" +
    "  Inkbox tunnel: ONE-TIME connect_secret disclosure\n" +
    "  This will not appear on subsequent runs.\n" +
    `  Secret persisted at: ${opts.statePath} (chmod 600)\n` +
    "=================================================================\n" +
    `  connect_secret = ${opts.secret}\n` +
    "=================================================================\n";
  process.stderr.write(banner);
}

export function defaultStateDir(name: string): string {
  return path.join(os.homedir(), ".inkbox", "tunnels", name);
}
