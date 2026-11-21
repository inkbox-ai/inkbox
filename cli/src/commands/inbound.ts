import { readFile } from "node:fs/promises";
import { Command, Option } from "commander";
import type { InboundHandler, InboundSignatureInput, InboundSource } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { readSecretFromStdin } from "../invitation-token.js";
import { output, printStatus } from "../output.js";
import { withErrorHandler } from "../errors.js";

const SOURCE_COLUMNS = ["id", "name", "url", "signature", "handler", "createdAt"];
const EVENT_COLUMNS = ["id", "receivedAt", "status", "attempts", "signatureVerified", "contentType", "sizeBytes", "lastError"];

interface SignatureOpts {
  secretStdin?: boolean;
  secretEncoding?: "text" | "base64";
  header?: string;
  format?: "whole" | "prefix" | "list";
  formatValue?: string;
  algorithm?: "sha256" | "sha1" | "sha512";
  encoding?: "hex" | "base64";
  signedContent?: string;
  timestampFrom?: "none" | "header" | "list";
  timestampValue?: string;
  maxAge?: string;
}

interface SourceOpts extends SignatureOpts {
  name?: string;
  signature?: boolean;
  handler?: "agent" | "script";
  instructions?: string;
  command?: string;
}

function flattenSource(source: InboundSource): Record<string, unknown> {
  return {
    ...source,
    signature: source.signature?.header ?? null,
    handler: source.handler.type === "script" ? `script: ${source.handler.command}` : "agent",
  };
}

const SETTINGS: Array<[keyof SignatureOpts, keyof InboundSignatureInput]> = [
  ["secretEncoding", "secretEncoding"], ["format", "format"], ["formatValue", "formatValue"], ["algorithm", "algorithm"],
  ["encoding", "encoding"], ["signedContent", "signedContent"], ["timestampFrom", "timestampFrom"], ["timestampValue", "timestampValue"],
];

// Secrets come only from stdin so they never land in shell history or process listings.
export async function buildSignature(opts: SourceOpts): Promise<InboundSignatureInput | null | undefined> {
  const settings = opts.header !== undefined || opts.maxAge !== undefined || SETTINGS.some(([flag]) => opts[flag] !== undefined);
  if (opts.signature === false) {
    if (opts.secretStdin || settings) throw new Error("--no-signature cannot be combined with signature options");
    return null;
  }
  if (!opts.secretStdin && !settings) return undefined;
  if (opts.header === undefined) throw new Error("--header is required to verify signatures");
  if (!opts.secretStdin) throw new Error("signature options require --secret-stdin");
  if (opts.maxAge !== undefined && !/^[1-9]\d*$/.test(opts.maxAge)) throw new Error("--max-age must be a positive integer");
  const signature: InboundSignatureInput = { secret: await readSecretFromStdin("signing secret"), header: opts.header };
  for (const [flag, field] of SETTINGS) if (opts[flag] !== undefined) Object.assign(signature, { [field]: opts[flag] });
  if (opts.maxAge !== undefined) signature.maxAgeSeconds = Number(opts.maxAge);
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

function signatureOptions(command: Command): Command {
  return command
    .option("--secret-stdin", "Read the sender's signing secret from stdin")
    .addOption(new Option("--secret-encoding <enc>", "How the secret is written; base64 ignores a leading whsec_ (default text)").choices(["text", "base64"]))
    .option("--header <name>", "Header holding the signature; turns on verification")
    .addOption(new Option("--format <format>", "whole header, value after a prefix, or a key in a list (default whole)").choices(["whole", "prefix", "list"]))
    .option("--format-value <value>", "The prefix (e.g. 'sha256=') or list key (e.g. v1)")
    .addOption(new Option("--algorithm <alg>", "HMAC algorithm (default sha256)").choices(["sha256", "sha1", "sha512"]))
    .addOption(new Option("--encoding <enc>", "Signature encoding (default hex)").choices(["hex", "base64"]))
    .option("--signed-content <template>", "What was signed; must include {body}, may use {timestamp}, {header:Name} and fixed text (default '{body}')")
    .addOption(new Option("--timestamp-from <source>", "Where the timestamp comes from (default none)").choices(["none", "header", "list"]))
    .option("--timestamp-value <value>", "Timestamp header name, or key in the signature header list (e.g. t)")
    .option("--max-age <seconds>", "Reject requests whose timestamp is further than this from now");
}

function sourceOptions(command: Command): Command {
  return signatureOptions(command)
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

  signatureOptions(
    inbound.command("check-signature <handle>")
      .description("Check a sample request against signature settings or a saved source; nothing is stored")
      .option("--source <source-id>", "Use this source's saved settings instead of signature options")
      .option("--sample-header <header>", "Sample request header as 'Name: value' (repeatable)", (value: string, all: string[]) => [...all, value], [])
      .requiredOption("--body-file <path>", "File holding the sample request body, exactly as sent"),
  ).action(withErrorHandler(async function (this: Command, handle: string, opts: SignatureOpts & { source?: string; sampleHeader: string[]; bodyFile: string }) {
    const headers: Record<string, string> = {};
    for (const line of opts.sampleHeader) {
      const colon = line.indexOf(":");
      if (colon < 1) throw new Error(`--sample-header must be 'Name: value', got '${line}'`);
      headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    const signature = await buildSignature(opts);
    if ((opts.source === undefined) === !signature) throw new Error("use either --source or signature options with --header and --secret-stdin");
    const raw = await readFile(opts.bodyFile);
    let body: string | Uint8Array;
    try { body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw); } catch { body = raw; }
    const global = getGlobalOpts(this);
    const result = await createClient(global).inbound.checkSignature(handle, {
      headers, body, ...(signature ? { signature } : { sourceId: opts.source }),
    });
    if (global.json) return output(result, { json: true });
    console.log(result.verified ? "Signature is valid." : `Signature is not valid: ${result.reason}`);
    if (!result.verified) process.exitCode = 1;
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
