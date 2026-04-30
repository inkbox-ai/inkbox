import { Command } from "commander";
import { SendingDomainStatus } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

const DOMAIN_LIST_COLUMNS = ["domain", "status", "isDefault", "verifiedAt", "id"];

export function registerDomainCommands(program: Command): void {
  const domain = program
    .command("domain")
    .description("Custom sending domains (list, set org default)");

  domain
    .command("list")
    .description("List custom sending domains for your organisation")
    .option("--status <status>", "Filter by status (e.g. 'verified')")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { status?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rows = await inkbox.domains.list(
          cmdOpts.status !== undefined
            ? { status: cmdOpts.status as SendingDomainStatus }
            : undefined,
        );
        output(
          rows.map((d) => ({
            id: d.id,
            domain: d.domain,
            status: d.status,
            isDefault: d.isDefault,
            verifiedAt: d.verifiedAt,
          })),
          {
            json: !!opts.json,
            columns: DOMAIN_LIST_COLUMNS,
          },
        );
      }),
    );

  domain
    .command("set-default <domain-name>")
    .description(
      "Set the org default sending domain (admin-scoped API key only). " +
        "Pass the platform sending domain (e.g. 'inkboxmail.com' in prod) to clear.",
    )
    .action(
      withErrorHandler(async function (this: Command, domainName: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const newDefault = await inkbox.domains.setDefault(domainName);
        output(
          { defaultDomain: newDefault },
          { json: !!opts.json },
        );
      }),
    );
}
