import { Inkbox } from "@inkbox/sdk";
import type { Command } from "commander";

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

export function createClient(opts: GlobalOpts): Inkbox {
  const apiKey = opts.apiKey ?? process.env.INKBOX_API_KEY;
  if (!apiKey) {
    console.error(
      "Error: API key required. Set INKBOX_API_KEY or pass --api-key.",
    );
    process.exit(1);
  }
  const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
  return new Inkbox({
    apiKey,
    vaultKey: vaultKey || undefined,
    baseUrl: opts.baseUrl,
  });
}
