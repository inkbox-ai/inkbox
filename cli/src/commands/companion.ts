import { Command } from "commander";
import type { CompanionChannel } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { withErrorHandler } from "../errors.js";
import { output } from "../output.js";

function integer(value: string, name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return result;
}

export function registerCompanionCommands(identity: Command): void {
  const companion = identity.command("companion").description("Companion mode configuration and conversation initialization");
  companion.command("get <handle>").description("Read configuration and channel readiness")
    .action(withErrorHandler(async function (this: Command, handle: string) {
      const opts = getGlobalOpts(this);
      const result = await createClient(opts).companion.get(handle);
      output(result as unknown as Record<string, unknown>, { json: !!opts.json });
    }));
  companion.command("update <handle>").description("Enable or disable Companion mode (administrator only)")
    .requiredOption("--enabled <boolean>", "Explicitly enable or disable: true or false")
    .action(withErrorHandler(async function (this: Command, handle: string, options: { enabled: string }) {
      if (options.enabled !== "true" && options.enabled !== "false") {
        throw new Error("--enabled must be true or false");
      }
      const update = { enabled: options.enabled === "true" };
      const opts = getGlobalOpts(this);
      const result = await createClient(opts).companion.update(handle, update);
      output(result as unknown as Record<string, unknown>, { json: !!opts.json });
    }));
  companion.command("conversations <handle>").alias("state").description("Read one page of visible conversation states")
    .option("--channel <channel>", "mail, phone, or imessage")
    .option("--limit <number>", "Page size (1-200)", "50")
    .option("--offset <number>", "Page offset", "0")
    .action(withErrorHandler(async function (this: Command, handle: string, options: { channel?: string; limit: string; offset: string }) {
      if (options.channel !== undefined && !["mail", "phone", "imessage"].includes(options.channel)) {
        throw new Error("--channel must be mail, phone, or imessage");
      }
      const query = { channel: options.channel as CompanionChannel | undefined,
        limit: integer(options.limit, "--limit", 1, 200), offset: integer(options.offset, "--offset", 0, 10000) };
      const opts = getGlobalOpts(this);
      const result = await createClient(opts).companion.conversations(handle, query);
      output(result as unknown as Record<string, unknown>, { json: !!opts.json });
    }));
  companion.command("history <handle> <activation-id>").description("Read one authorized snapshot page, including cursor and completion")
    .option("--limit <number>", "Page size (1-200)", "100")
    .option("--cursor <cursor>", "Opaque continuation cursor")
    .action(withErrorHandler(async function (this: Command, handle: string, activationId: string, options: { limit: string; cursor?: string }) {
      const query = { limit: integer(options.limit, "--limit", 1, 200), cursor: options.cursor };
      const opts = getGlobalOpts(this);
      const result = await createClient(opts).companion.activationMessages(handle, activationId, query);
      output(result as unknown as Record<string, unknown>, { json: !!opts.json });
    }));
  companion.command("initialization <handle> <activation-id>").description("Load complete bounded history as one combined transcript")
    .option("--max-bytes <number>", "Maximum fetched-page and transcript UTF-8 bytes", "8388608")
    .option("--max-pages <number>", "Maximum history pages, excluding final revalidation", "1000")
    .action(withErrorHandler(async function (this: Command, handle: string, activationId: string, options: { maxBytes: string; maxPages: string }) {
      const bounds = { maxBytes: integer(options.maxBytes, "--max-bytes", 1), maxPages: integer(options.maxPages, "--max-pages", 1) };
      const opts = getGlobalOpts(this);
      const result = await createClient(opts).companion.loadInitialization(handle, activationId, bounds);
      output(result as unknown as Record<string, unknown>, { json: !!opts.json });
    }));
}
