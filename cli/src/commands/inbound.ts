import { Command, Option } from "commander";
import type { InboundHandler, InboundSignatureInput, InboundSignatureScheme, InboundSource } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { readSecretFromStdin } from "../invitation-token.js";
import { output, printStatus } from "../output.js";
import { withErrorHandler } from "../errors.js";

const SOURCE_COLUMNS = ["id", "name", "url", "signature", "handler", "createdAt"];
const EVENT_COLUMNS = ["id", "receivedAt", "status", "attempts", "signatureVerified", "contentType", "sizeBytes", "lastError"];

interface SourceOpts {
  name?: string;
  scheme?: InboundSignatureScheme;
  secretStdin?: boolean;
  header?: string;
  algorithm?: "sha256" | "sha1";
  encoding?: "hex" | "base64";
  prefix?: string;
  signature?: boolean;
  handler?: "agent" | "script";
  instructions?: string;
  command?: string;
}

function flattenSource(source: InboundSource): Record<string, unknown> {
  return {
    ...source,
    signature: source.signature?.scheme ?? null,
    handler: source.handler.type === "script" ? `script: ${source.handler.command}` : "agent",
  };
}

// Secrets come only from stdin so they never land in shell history or process listings.
export async function buildSignature(opts: SourceOpts): Promise<InboundSignatureInput | null | undefined> {
  const hmacOnly = [opts.header, opts.algorithm, opts.encoding, opts.prefix].some(v => v !== undefined);
  if (opts.signature === false) {
    if (opts.scheme || opts.secretStdin || hmacOnly) throw new Error("--no-signature cannot be combined with signature options");
    return null;
  }
  if (!opts.scheme) {
    if (opts.secretStdin || hmacOnly) throw new Error("--scheme is required with signature options");
    return undefined;
  }
  if (!opts.secretStdin) throw new Error("--scheme requires --secret-stdin");
  if (hmacOnly && opts.scheme !== "hmac") throw new Error("--header, --algorithm, --encoding and --prefix apply only to --scheme hmac");
  if (opts.scheme === "hmac" && opts.header === undefined) throw new Error("--scheme hmac requires --header");
  const signature: InboundSignatureInput = { scheme: opts.scheme, secret: await readSecretFromStdin("signing secret") };
  if (opts.header !== undefined) signature.header = opts.header;
  if (opts.algorithm !== undefined) signature.algorithm = opts.algorithm;
  if (opts.encoding !== undefined) signature.encoding = opts.encoding;
  if (opts.prefix !== undefined) signature.prefix = opts.prefix;
  return signature;
}

export function buildHandler(opts: SourceOpts): InboundHandler | undefined {
  if (opts.handler === undefined) {
    if (opts.instructions !== undefined || opts.command !== undefined) throw new Error("--handler is required with --instructions or --command");
    return undefined;
  }
  if (opts.handler === "script") {
    if (!opts.command) throw new Error("--handler script requires --command");
    if (opts.instructions !== undefined) throw new Error("--instructions applies only to --handler agent");
    return { type: "script", command: opts.command };
  }
  if (opts.command !== undefined) throw new Error("--command applies only to --handler script");
  return opts.instructions !== undefined ? { type: "agent", instructions: opts.instructions } : { type: "agent" };
}

function sourceOptions(command: Command): Command {
  return command
    .addOption(new Option("--scheme <scheme>", "Sender signature scheme").choices(["stripe", "github", "slack", "standard-webhooks", "hmac"]))
    .option("--secret-stdin", "Read the sender's signing secret from stdin")
    .option("--header <name>", "Signature header (hmac only)")
    .addOption(new Option("--algorithm <alg>", "HMAC algorithm (hmac only)").choices(["sha256", "sha1"]))
    .addOption(new Option("--encoding <enc>", "Signature encoding (hmac only)").choices(["hex", "base64"]))
    .option("--prefix <prefix>", "Signature value prefix, e.g. 'sha256=' (hmac only)")
    .addOption(new Option("--handler <type>", "Who handles each request").choices(["agent", "script"]))
    .option("--instructions <text>", "Extra instructions for the agent (agent handler)")
    .option("--command <cmd>", "Command to run on the agent's computer (script handler)");
}

export function registerInboundCommands(program: Command): void {
  const inbound = program
    .command("inbound")
    .description("Manage inbound sources: public URLs that deliver external requests to a hosted agent");

  sourceOptions(
    inbound.command("create <handle>")
      .description("Create an inbound source and print its public URL")
      .requiredOption("--name <name>", "Source name"),
  ).action(withErrorHandler(async function (this: Command, handle: string, opts: SourceOpts) {
    const global = getGlobalOpts(this);
    const handler = buildHandler(opts) ?? { type: "agent" as const };
    const signature = await buildSignature(opts);
    const source = await createClient(global).inbound.createSource(handle, { name: opts.name!, handler, signature: signature ?? null });
    output(global.json ? source : flattenSource(source), { json: !!global.json });
  }));

  inbound.command("list <handle>")
    .description("List an identity's inbound sources")
    .action(withErrorHandler(async function (this: Command, handle: string) {
      const global = getGlobalOpts(this);
      const sources = await createClient(global).inbound.listSources(handle);
      output(global.json ? sources : sources.map(flattenSource), { json: !!global.json, columns: SOURCE_COLUMNS });
    }));

  inbound.command("get <handle> <source-id>")
    .description("Show an inbound source")
    .action(withErrorHandler(async function (this: Command, handle: string, sourceId: string) {
      const global = getGlobalOpts(this);
      output(await createClient(global).inbound.getSource(handle, sourceId), { json: !!global.json });
    }));

  sourceOptions(
    inbound.command("update <handle> <source-id>")
      .description("Update an inbound source; omitted settings are unchanged")
      .option("--name <name>", "New source name")
      .option("--no-signature", "Remove sender signature verification"),
  ).action(withErrorHandler(async function (this: Command, handle: string, sourceId: string, opts: SourceOpts) {
    const update: { name?: string; handler?: InboundHandler; signature?: InboundSignatureInput | null } = {};
    const handler = buildHandler(opts);
    const signature = await buildSignature(opts);
    if (opts.name !== undefined) update.name = opts.name;
    if (handler !== undefined) update.handler = handler;
    if (signature !== undefined) update.signature = signature;
    if (!Object.keys(update).length) throw new Error("Nothing to update");
    const global = getGlobalOpts(this);
    output(await createClient(global).inbound.updateSource(handle, sourceId, update), { json: !!global.json });
  }));

  inbound.command("delete <handle> <source-id>")
    .description("Delete an inbound source; its URL stops accepting requests")
    .action(withErrorHandler(async function (this: Command, handle: string, sourceId: string) {
      const global = getGlobalOpts(this);
      await createClient(global).inbound.deleteSource(handle, sourceId);
      printStatus(`Deleted inbound source '${sourceId}'.`);
    }));

  inbound.command("rotate <handle> <source-id>")
    .description("Issue a new URL; the previous URL stops accepting requests")
    .action(withErrorHandler(async function (this: Command, handle: string, sourceId: string) {
      const global = getGlobalOpts(this);
      output(await createClient(global).inbound.rotateSource(handle, sourceId), { json: !!global.json });
    }));

  const events = inbound.command("events").description("Inspect and replay received requests");
  events.command("list <handle> <source-id>")
    .description("List received requests, newest first")
    .option("--limit <n>", "Maximum events to return")
    .option("--cursor <cursor>", "Cursor from a previous page")
    .action(withErrorHandler(async function (this: Command, handle: string, sourceId: string, opts: { limit?: string; cursor?: string }) {
      if (opts.limit !== undefined && !/^[1-9]\d*$/.test(opts.limit)) throw new Error("--limit must be a positive integer");
      const global = getGlobalOpts(this);
      const page = await createClient(global).inbound.listEvents(handle, sourceId, {
        limit: opts.limit === undefined ? undefined : Number(opts.limit), cursor: opts.cursor,
      });
      if (global.json) return output(page, { json: true });
      output(page.events, { json: false, columns: EVENT_COLUMNS });
      if (page.nextCursor) console.log(`\nNext page: --cursor ${page.nextCursor}`);
    }));
  events.command("get <handle> <source-id> <event-id>")
    .description("Show a received request, including its headers and body")
    .action(withErrorHandler(async function (this: Command, handle: string, sourceId: string, eventId: string) {
      const global = getGlobalOpts(this);
      output(await createClient(global).inbound.getEvent(handle, sourceId, eventId), { json: !!global.json });
    }));
  events.command("replay <handle> <source-id> <event-id>")
    .description("Deliver a received request to the agent again")
    .action(withErrorHandler(async function (this: Command, handle: string, sourceId: string, eventId: string) {
      const global = getGlobalOpts(this);
      output(await createClient(global).inbound.replayEvent(handle, sourceId, eventId), { json: !!global.json });
    }));
}
