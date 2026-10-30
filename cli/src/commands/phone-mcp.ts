import { readFile } from "node:fs/promises";
import { Command } from "commander";
import type { HostedMcpCreate, HostedMcpUpdate } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import { readSecretFromStdin } from "../invitation-token.js";

export async function readMcpBody(file: string): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = JSON.parse(file === "-" ? await readSecretFromStdin("connection JSON") : await readFile(file, "utf8"));
  } catch {
    throw new Error("Cannot read connection JSON. Use a JSON file or '-' for stdin.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Connection JSON must be an object.");
  }
  const result = body as Record<string, unknown>;
  checkFields(result, ["label", "url", "transport", "auth", "enabled", "allowedTools", "context", "expectedVersion"]);
  if (result.auth !== undefined) checkFields(result.auth, ["type", "token", "headerName", "valuePrefix", "issuer", "scopes",
    "clientId", "clientSecret", "tokenEndpointAuthMethod", "profile"]);
  if (result.context !== undefined) {
    checkFields(result.context, ["mode", "prompts", "resources", "skills"]);
    const context = result.context as Record<string, unknown>;
    for (const [name, fields] of [["skills", ["uri", "manifestDigest"]], ["prompts", ["name", "arguments"]]] as const) {
      if (context[name] !== undefined) {
        if (!Array.isArray(context[name])) throw new Error("Selected context must use arrays.");
        for (const value of context[name]) checkFields(value, fields);
      }
    }
  }
  return result;
}

function checkFields(value: unknown, fields: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) {
    throw new Error("Invalid connection JSON fields. Use SDK names such as allowedTools, expectedVersion, and manifestDigest.");
  }
}

export function registerPhoneMcpCommands(parent: Command): void {
  const mcp = parent.command("mcp").description("Manage Voice AI external connections (up to three per identity)");
  const oauth = mcp.command("oauth").description("Connect external accounts through browser approval");
  oauth.command("connect <id>").requiredOption("--expected-version <number>", "Current connection version")
    .requiredOption("--idempotency-key <key>", "Reuse this key when retrying this request")
    .option("--wait <seconds>", "Poll authorization for up to 600 seconds")
    .action(withErrorHandler(async function (this: Command, id: string, args: { expectedVersion: string; idempotencyKey: string; wait?: string }) {
      const opts = getGlobalOpts(this);
      const expectedVersion = positiveInteger(args.expectedVersion, 2147483647);
      const wait = args.wait === undefined ? 0 : positiveInteger(args.wait, 600);
      const client = createClient(opts).hostedAgent;
      let result = await client.startMcpAuthorization(id, { expectedVersion, idempotencyKey: args.idempotencyKey });
      if (wait && result.connectUrl) process.stderr.write(`Open this URL to connect: ${result.connectUrl}\n`);
      const deadline = Date.now() + wait * 1000;
      while (Date.now() < deadline && ["pending", "launched", "exchanging"].includes(result.status)) {
        await new Promise(resolve => setTimeout(resolve, Math.min(2000, deadline - Date.now())));
        if (Date.now() >= deadline) break;
        result = await client.getMcpAuthorization(id, result.id);
      }
      output(result, { json: !!opts.json });
    }));
  oauth.command("status <id> <transaction-id>").action(withErrorHandler(async function (this: Command, id: string, transactionId: string) {
    const opts = getGlobalOpts(this);
    output(await createClient(opts).hostedAgent.getMcpAuthorization(id, transactionId), { json: !!opts.json });
  }));
  oauth.command("cancel <id> <transaction-id>").action(withErrorHandler(async function (this: Command, id: string, transactionId: string) {
    const opts = getGlobalOpts(this);
    await createClient(opts).hostedAgent.cancelMcpAuthorization(id, transactionId);
    output({ canceled: true }, { json: !!opts.json });
  }));
  oauth.command("disconnect <id>").requiredOption("--expected-version <number>", "Current connection version")
    .requiredOption("--idempotency-key <key>", "Reuse this key when retrying disconnect")
    .action(withErrorHandler(async function (this: Command, id: string, args: { expectedVersion: string; idempotencyKey: string }) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).hostedAgent.disconnectMcpServer(id, {
        expectedVersion: positiveInteger(args.expectedVersion, 2147483647), idempotencyKey: args.idempotencyKey,
      }), { json: !!opts.json });
    }));
  mcp.command("list").requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (this: Command, args: { identity: string }) {
      const opts = getGlobalOpts(this);
      const identity = await createClient(opts).getIdentity(args.identity);
      output(await identity.listMcpServers(), { json: !!opts.json });
    }));
  mcp.command("create").requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("--file <path>", "Connection JSON using SDK field names; '-' reads stdin. Include auth here, never in arguments")
    .requiredOption("--idempotency-key <key>", "Reuse this key when retrying creation")
    .action(withErrorHandler(async function (this: Command, args: { identity: string; file: string; idempotencyKey: string }) {
      const opts = getGlobalOpts(this);
      const body = await readMcpBody(args.file);
      const identity = await createClient(opts).getIdentity(args.identity);
      output(await identity.createMcpServer(body as unknown as HostedMcpCreate, args), { json: !!opts.json });
    }));
  mcp.command("update <id>")
    .requiredOption("--file <path>", "Patch JSON with expectedVersion; '-' reads stdin. URL edits require replacement auth")
    .action(withErrorHandler(async function (this: Command, id: string, args: { file: string }) {
      const opts = getGlobalOpts(this);
      const body = await readMcpBody(args.file);
      output(await createClient(opts).hostedAgent.updateMcpServer(id, body as unknown as HostedMcpUpdate), { json: !!opts.json });
    }));
  mcp.command("get <id>").action(withErrorHandler(async function (this: Command, id: string) {
    const opts = getGlobalOpts(this);
    output(await createClient(opts).hostedAgent.getMcpServer(id), { json: !!opts.json });
  }));
  mcp.command("delete <id>").action(withErrorHandler(async function (this: Command, id: string) {
    const opts = getGlobalOpts(this);
    await createClient(opts).hostedAgent.deleteMcpServer(id);
    output({ deleted: true }, { json: !!opts.json });
  }));
  mcp.command("test <id>").action(withErrorHandler(async function (this: Command, id: string) {
    const opts = getGlobalOpts(this);
    output(await createClient(opts).hostedAgent.testMcpServer(id), { json: !!opts.json });
  }));
  mcp.command("refresh <id>").requiredOption("--idempotency-key <key>", "Reuse this key when retrying refresh")
    .action(withErrorHandler(async function (this: Command, id: string, args: { idempotencyKey: string }) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).hostedAgent.refreshMcpServer(id, args), { json: !!opts.json });
    }));
  mcp.command("catalog <id>").option("--cursor <cursor>", "Next-page cursor").option("--skill-uri <uri>", "Inspect one skill manifest for approval")
    .action(withErrorHandler(async function (this: Command, id: string, args: { cursor?: string; skillUri?: string }) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).hostedAgent.getMcpCatalog(id, args), { json: !!opts.json });
    }));
  mcp.command("activity <call-id>").option("--offset <number>", "Pagination offset", "0")
    .action(withErrorHandler(async function (this: Command, callId: string, args: { offset: string }) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).hostedAgent.getMcpActivity(callId, { offset: Number(args.offset) }), { json: !!opts.json });
    }));
}

function positiveInteger(value: string, maximum: number): number {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
    throw new Error(`Expected an integer between 1 and ${maximum}.`);
  }
  return Number(value);
}
