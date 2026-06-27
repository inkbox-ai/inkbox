/**
 * inkbox/src/_config.ts
 *
 * Resolve client settings from explicit options, then env vars, then the
 * `~/.inkbox/config` file. Background / agent processes often don't inherit
 * the shell's env, so a file fallback is handy. Same `key = value` format the
 * Python SDK and CLI read.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ClientSettings {
  apiKey?: string;
  baseUrl?: string;
  vaultKey?: string;
}

// ~/.inkbox/config — `key = value` lines (# comments, surrounding quotes stripped).
function readConfigFile(): Record<string, string> {
  try {
    const file = path.join(os.homedir(), ".inkbox", "config");
    const text = fs.readFileSync(file, "utf-8");
    const out: Record<string, string> = {};
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const eq = line.indexOf("=");
      const key = line.slice(0, eq).trim();
      const value = line
        .slice(eq + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Resolve each setting: explicit option → env var → `~/.inkbox/config`. */
export function resolveClientSettings(explicit: ClientSettings): ClientSettings {
  let file: Record<string, string> | undefined;
  const pick = (
    value: string | undefined,
    env: string,
    key: string,
  ): string | undefined => {
    if (value !== undefined) return value;
    const envValue = process.env[env];
    if (envValue) return envValue;
    file ??= readConfigFile();
    return file[key];
  };
  return {
    apiKey: pick(explicit.apiKey, "INKBOX_API_KEY", "api_key"),
    baseUrl: pick(explicit.baseUrl, "INKBOX_BASE_URL", "base_url"),
    vaultKey: pick(explicit.vaultKey, "INKBOX_VAULT_KEY", "vault_key"),
  };
}
