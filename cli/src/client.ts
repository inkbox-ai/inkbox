import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Inkbox } from "@inkbox/sdk";
import type { Command } from "commander";

// Keep in sync with package.json "version".
export const CLI_VERSION = "0.5.1";

export interface GlobalOpts {
  apiKey?: string;
  vaultKey?: string;
  baseUrl?: string;
  json?: boolean;
}

export function getGlobalOpts(cmd: Command): GlobalOpts {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as GlobalOpts;
}

// ~/.inkbox/config — simple `key = value` lines (# comments, quotes stripped).
// Lets background/agent processes that don't inherit the shell env still auth.
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

/** Same precedence as createClient: flag, then env, then ~/.inkbox/config. */
export function resolveBaseUrl(opts: GlobalOpts): string | undefined {
  return (
    opts.baseUrl ?? process.env.INKBOX_BASE_URL ?? readConfigFile().base_url
  );
}

export function createClient(opts: GlobalOpts): Inkbox {
  const fileCfg = readConfigFile();
  const apiKey = opts.apiKey ?? process.env.INKBOX_API_KEY ?? fileCfg.api_key;
  if (!apiKey) {
    console.error(
      "Error: API key required. Set INKBOX_API_KEY, pass --api-key, or add " +
        "'api_key = ...' to ~/.inkbox/config.",
    );
    process.exit(1);
  }
  const vaultKey =
    opts.vaultKey ?? process.env.INKBOX_VAULT_KEY ?? fileCfg.vault_key;
  const baseUrl = opts.baseUrl ?? process.env.INKBOX_BASE_URL ?? fileCfg.base_url;
  return new Inkbox({
    apiKey,
    vaultKey: vaultKey || undefined,
    baseUrl,
    userAgentPrefix: `inkbox-cli/${CLI_VERSION}`,
  });
}
