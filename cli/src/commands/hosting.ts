import { readFile } from "node:fs/promises";
import { Command, Option } from "commander";
import type { HostingUpdate } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerHostingCommands(identity: Command): void {
  const hosting = identity.command("hosting").description("Manage an identity's hosted agent");
  hosting.command("get <handle>").action(withErrorHandler(async function (this: Command, handle: string) {
    const opts = getGlobalOpts(this);
    output(await createClient(opts).identities.getHosting(handle), { json: !!opts.json });
  }));
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
    .addOption(new Option("--harness <name>", "Agent harness").choices(["codex", "hermes"]))
    .addOption(new Option("--size <size>", "Computer size").choices(["small", "medium", "large"]))
    .option("--instructions-file <path>", "Read hosted-agent instructions from a UTF-8 file")
    .option("--events <events>", "Comma-separated trigger events; an empty string disables event triggers")
    .option("--default-events", "Restore default trigger events")
    .option("--model-key <id>", "Use a saved organization model-key ID")
    .option("--credits", "Use the organization's remaining model credits")
    .option("--idle-seconds <seconds>", "Stop after this many idle seconds (60–86400)")
    .action(withErrorHandler(async function (this: Command, handle: string, opts: {
      expectedGeneration: string; harness?: "codex" | "hermes"; size?: "small" | "medium" | "large";
      instructionsFile?: string; events?: string; defaultEvents?: boolean; modelKey?: string;
      credits?: boolean; idleSeconds?: string;
    }) {
      const expectedGeneration = generation(opts.expectedGeneration);
      if (opts.events !== undefined && opts.defaultEvents) throw new Error("Choose events or default events, not both");
      if (opts.modelKey && opts.credits) throw new Error("Choose a model key or credits, not both");
      const update: HostingUpdate = { expectedGeneration, harness: opts.harness, tier: opts.size };
      if (opts.instructionsFile) {
        update.instructions = await readFile(opts.instructionsFile, "utf8");
        if (update.instructions.length > 32768) throw new Error("Instructions exceed 32768 characters");
      }
      if (opts.events !== undefined) update.triggerEvents = opts.events.split(",").map(v => v.trim()).filter(Boolean);
      if (opts.defaultEvents) update.followDefaults = true;
      if (opts.modelKey) update.credentialBindingId = opts.modelKey;
      if (opts.credits) update.credentialBindingId = null;
      if (opts.idleSeconds !== undefined) {
        const seconds = Number(opts.idleSeconds);
        if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86400) throw new Error("Idle seconds must be between 60 and 86400");
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

function generation(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Generation must be a nonnegative integer");
  return Number(value);
}
