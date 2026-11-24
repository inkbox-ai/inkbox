import { registerWorkspaceCommands } from "./workspace.js";
import { readFile } from "node:fs/promises";
import { Command, Option } from "commander";
import { InkboxAPIError, type Inkbox } from "@inkbox/sdk";
import type { HostingHarness, HostingModel, HostingPorts, HostingPortsUpdate, HostingUpdate } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerHostingCommands(identity: Command): void {
  const hosting = identity.command("hosting").description("Manage an identity's hosted agent");
  registerWorkspaceCommands(hosting);
  hosting.command("get <handle>").action(withErrorHandler(async function (this: Command, handle: string) {
    const opts = getGlobalOpts(this);
    output(await createClient(opts).identities.getHosting(handle), { json: !!opts.json });
  }));
  registerPortCommands(hosting);
  hosting.command("deliveries <handle>")
    .description("List event handoffs; accepted does not mean replied")
    .option("--before <id>", "Read older deliveries before this ID")
    .action(withErrorHandler(async function (this: Command, handle: string, options: {before?: string}) {
      const global = getGlobalOpts(this);
      output(await createClient(global).identities.listHostingDeliveries(handle, options.before), {json: !!global.json});
    }));
  hosting.command("retry <handle> <delivery-id>")
    .description("Retry an eligible failed event without creating a duplicate event")
    .action(withErrorHandler(async function (this: Command, handle: string, deliveryId: string) {
      const global = getGlobalOpts(this);
      output({queued: await createClient(global).identities.retryHostingDelivery(handle, deliveryId)}, {json: !!global.json});
    }));
  hosting.command("configure <handle>")
    .description("Enable or update hosting using the generation returned by get")
    .requiredOption("--expected-generation <number>", "Current generation; 0 for initial setup")
    .addOption(new Option("--harness <name>", "Agent harness").choices(["codex", "hermes", "claude_code", "opencode", "deepseek", "openclaw"]))
    .addOption(new Option("--default-model <model>", "Default model for turns and scheduled work").choices(["gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra", "claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2", "deepseek-flash", "deepseek-v4-pro"]))
    .addOption(new Option("--size <size>", "Legacy size: 1 vCPU and 4 GiB RAM").choices(["medium"]))
    .option("--shape <id>", "Initial CPU/RAM allocation from computers shapes")
    .option("--reset-instructions", "Restore default hosted-agent instructions")
    .option("--idle-stop", "Enable idle shutdown")
    .option("--instructions-file <path>", "Read hosted-agent instructions from a UTF-8 file")
    .option("--events <events>", "Comma-separated trigger events; an empty string disables event triggers")
    .option("--default-events", "Restore default trigger events")
    .option("--model-key <id>", "Use a saved organization model-key ID")
    .option("--credits", "Use Inkbox credits")
    .option("--idle-seconds <seconds>", "Stop after 60 or 300 idle seconds")
    .action(withErrorHandler(async function (this: Command, handle: string, opts: {
      expectedGeneration: string; harness?: HostingHarness; size?: "medium";
      shape?: string;
      defaultModel?: HostingModel;
      instructionsFile?: string; events?: string; defaultEvents?: boolean; modelKey?: string;
      credits?: boolean; idleSeconds?: string; resetInstructions?: boolean; idleStop?: boolean;
    }) {
      const expectedGeneration = generation(opts.expectedGeneration);
      if (opts.events !== undefined && opts.defaultEvents) throw new Error("Choose events or default events, not both");
      if (opts.modelKey && opts.credits) throw new Error("Choose a model key or credits, not both");
      if (opts.shape && opts.size) throw new Error("Choose a shape or legacy size, not both");
      const update: HostingUpdate = { expectedGeneration, harness: opts.harness, tier: opts.size, shapeId: opts.shape, defaultModel: opts.defaultModel };
      if (opts.resetInstructions && opts.instructionsFile) throw new Error("Choose reset or custom instructions");
      if (opts.idleStop) update.idleStopEnabled = true;
      if (opts.resetInstructions) update.resetInstructions = true;
      if (opts.instructionsFile) {
        update.instructions = await readFile(opts.instructionsFile, "utf8");
        if (Buffer.byteLength(update.instructions, "utf8") > 32768) throw new Error("Instructions exceed 32768 UTF-8 bytes");
      }
      if (opts.events !== undefined) update.triggerEvents = opts.events.split(",").map(v => v.trim()).filter(Boolean);
      if (opts.defaultEvents) update.followDefaults = true;
      if (opts.modelKey) update.credentialBindingId = opts.modelKey;
      if (opts.credits) update.credentialBindingId = null;
      if (opts.idleSeconds !== undefined) {
        const seconds = Number(opts.idleSeconds);
        if (seconds !== 60 && seconds !== 300) throw new Error("Idle seconds must be 60 or 300");
        update.idleTimeoutSeconds = seconds;
      }
      const global = getGlobalOpts(this);
      output(await createClient(global).identities.updateHosting(handle, update), { json: !!global.json });
    }));
  hosting.command("remove <handle>")
    .description("Remove the hosted computer while keeping the identity and its channels")
    .requiredOption("--expected-generation <number>", "Current generation returned by get")
    .action(withErrorHandler(async function (this: Command, handle: string, opts: { expectedGeneration: string }) {
      const global = getGlobalOpts(this);
      output(await createClient(global).identities.updateHosting(handle, {
        expectedGeneration: generation(opts.expectedGeneration), enabled: false,
      }), { json: !!global.json });
    }));
}

function registerPortCommands(hosting: Command): void {
  const ports = hosting.command("ports").description("Show and manage the agent URL and its ports");
  ports.command("show <handle>")
    .description("Show the agent URL, default port and per-port access; token links are shown only when issued")
    .action(withErrorHandler(async function (this: Command, handle: string) {
      const global = getGlobalOpts(this);
      show(await createClient(global).identities.getHostingPorts(handle), !!global.json);
    }));
  ports.command("default <handle> <port>")
    .description("Set the port served at the agent URL; 'none' clears it")
    .action(withErrorHandler(async function (this: Command, handle: string, port: string) {
      const defaultPort = port === "none" ? null : portNumber(port);
      const global = getGlobalOpts(this);
      show(await updatePorts(createClient(global), handle, (current) => {
        const update: HostingPortsUpdate = { version: current.version, defaultPort };
        // A new default port is added as private in the same update.
        if (defaultPort !== null && !current.ports.some(p => p.port === defaultPort)) {
          update.ports = [...current.ports.map(p => ({ port: p.port, public: p.public })), { port: defaultPort, public: false }];
        }
        return update;
      }), !!global.json);
    }));
  ports.command("set <handle> <port>")
    .description("Make a port public (no token needed) or private (token required)")
    .option("--public", "Allow access without a token")
    .option("--private", "Require the port's access token")
    .action(withErrorHandler(async function (this: Command, handle: string, port: string, opts: { public?: boolean; private?: boolean }) {
      if (!!opts.public === !!opts.private) throw new Error("Choose exactly one of --public or --private");
      const number = portNumber(port);
      const global = getGlobalOpts(this);
      show(await updatePorts(createClient(global), handle, (current) => {
        const settings = current.ports.filter(p => p.port !== number).map(p => ({ port: p.port, public: p.public }));
        settings.push({ port: number, public: !!opts.public });
        return { version: current.version, ports: settings };
      }), !!global.json);
    }));
  ports.command("rotate-token <handle> <port>")
    .description("Issue a new access token for a port; the previous token stops working")
    .action(withErrorHandler(async function (this: Command, handle: string, port: string) {
      const global = getGlobalOpts(this);
      show(await createClient(global).identities.rotateHostingPortToken(handle, portNumber(port)), !!global.json);
    }));
}

async function updatePorts(client: Inkbox, handle: string, build: (current: HostingPorts) => HostingPortsUpdate): Promise<HostingPorts> {
  const attempt = async () => client.identities.updateHostingPorts(handle, build(await client.identities.getHostingPorts(handle)));
  try {
    return await attempt();
  } catch (err) {
    if (!staleVersion(err)) throw err;
    return attempt();
  }
}

function staleVersion(err: unknown): boolean {
  if (!(err instanceof InkboxAPIError) || err.statusCode !== 409) return false;
  const detail = err.detail;
  return typeof detail === "string" ? detail === "stale_version" : detail?.error === "stale_version" || detail?.code === "stale_version";
}

function show(ports: HostingPorts, json: boolean): void {
  if (json) return output(ports, { json });
  output({ url: ports.url, defaultPort: ports.defaultPort }, { json });
  if (ports.ports.length) {
    console.log("");
    output(ports.ports, { json, columns: ["port", "public", "url", "tokenUrl"] });
  }
}

function portNumber(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) throw new Error("Port must be an integer from 1 to 65535");
  return port;
}

function generation(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Generation must be a nonnegative integer");
  return Number(value);
}
