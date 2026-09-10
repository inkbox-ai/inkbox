import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { withErrorHandler } from "../errors.js";
import { output } from "../output.js";

export function registerOrganizationDomainCommands(program: Command): void {
  const domains = program.command("organization-domain")
    .description("Certify domain ownership (admin API key required)");

  domains.command("create <domain>")
    .description("Create a TXT challenge without publishing an agent's affiliation")
    .action(withErrorHandler(async function (this: Command, domain: string) {
      output(await createClient(getGlobalOpts(this)).organizationDomains.create(domain), { json: !!getGlobalOpts(this).json });
    }));

  domains.command("list")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--limit <n>", "Results per page (1-100)", "50")
    .action(withErrorHandler(async function (this: Command, options: { cursor?: string; limit: string }) {
      const limit = Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError("limit must be between 1 and 100");
      const page = await createClient(getGlobalOpts(this)).organizationDomains.list({ cursor: options.cursor, limit });
      const json = !!getGlobalOpts(this).json;
      output(json ? page : page.items, { json, columns: ["id", "domain", "state", "validUntil", "ownershipConflict"] });
      if (!json && page.nextCursor) console.error(`Next cursor: ${page.nextCursor}`);
    }));

  for (const [name, description] of [
    ["get", "Show a claim and its exact TXT instructions"],
    ["verify", "Recheck DNS proof for a claim"],
    ["transfer", "Explicitly request ownership transfer using fresh DNS proof"],
  ] as const) {
    domains.command(`${name} <claim-id>`).description(description)
      .action(withErrorHandler(async function (this: Command, claimId: string) {
        output(await createClient(getGlobalOpts(this)).organizationDomains[name](claimId), { json: !!getGlobalOpts(this).json });
      }));
  }

  domains.command("delete <claim-id>")
    .description("Release a claim and remove its agents' affiliations")
    .action(withErrorHandler(async function (this: Command, claimId: string) {
      await createClient(getGlobalOpts(this)).organizationDomains.delete(claimId);
      output({ released: claimId }, { json: !!getGlobalOpts(this).json });
    }));
}
