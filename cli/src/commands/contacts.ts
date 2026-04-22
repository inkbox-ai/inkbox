import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import type { CreateContactOptions } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

function parseJsonArg<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(
      `Could not parse ${label} as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function registerContactsAccessCommands(parent: Command): void {
  const access = parent
    .command("access")
    .description("Per-contact access grants");

  access
    .command("list <contact-id>")
    .description("List grants on a contact")
    .action(
      withErrorHandler(async function (this: Command, contactId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rows = await inkbox.contacts.access.list(contactId);
        output(rows, {
          json: !!opts.json,
          columns: ["id", "contactId", "identityId", "createdAt"],
        });
      }),
    );

  access
    .command("grant <contact-id>")
    .description("Grant access on a contact (admin + JWT only)")
    .option("--identity <uuid>", "Identity UUID to grant")
    .option("--wildcard", "Reset to wildcard grant (every active identity)", false)
    .action(
      withErrorHandler(async function (
        this: Command,
        contactId: string,
        cmdOpts: { identity?: string; wildcard?: boolean },
      ) {
        if (cmdOpts.wildcard && cmdOpts.identity) {
          throw new Error("Pass either --identity <uuid> or --wildcard, not both.");
        }
        if (!cmdOpts.wildcard && !cmdOpts.identity) {
          throw new Error("One of --identity or --wildcard is required.");
        }
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const grant = await inkbox.contacts.access.grant(contactId, {
          identityId: cmdOpts.identity,
          wildcard: cmdOpts.wildcard,
        });
        output(grant as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  access
    .command("revoke <contact-id> <identity-id>")
    .description("Revoke a specific identity's grant (self-only for agents)")
    .action(
      withErrorHandler(async function (
        this: Command,
        contactId: string,
        identityId: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.contacts.access.revoke(contactId, identityId);
        console.log(`Revoked identity ${identityId} on contact ${contactId}.`);
      }),
    );
}

export function registerContactsCommands(program: Command): void {
  const contacts = program
    .command("contacts")
    .description("Org-wide address book (contacts + access + vCard)");

  contacts
    .command("list")
    .description("List contacts")
    .option("--q <query>", "Case-insensitive substring search (≤100 chars)")
    .option("--order <order>", "name or recent")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10))
    .option("--offset <n>", "Offset", (v) => parseInt(v, 10))
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { q?: string; order?: string; limit?: number; offset?: number },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rows = await inkbox.contacts.list(cmdOpts);
        output(rows, {
          json: !!opts.json,
          columns: [
            "id",
            "preferredName",
            "givenName",
            "familyName",
            "companyName",
            "jobTitle",
            "updatedAt",
          ],
        });
      }),
    );

  contacts
    .command("get <contact-id>")
    .description("Fetch a single contact")
    .action(
      withErrorHandler(async function (this: Command, contactId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const contact = await inkbox.contacts.get(contactId);
        output(contact as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  contacts
    .command("create")
    .description("Create a contact (pass the full payload as JSON)")
    .requiredOption("--json <payload>", "JSON payload matching CreateContactOptions")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { json: string },
      ) {
        const opts = getGlobalOpts(this);
        const payload = parseJsonArg<CreateContactOptions>(cmdOpts.json, "--json payload");
        const inkbox = createClient(opts);
        const contact = await inkbox.contacts.create(payload);
        output(contact as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  contacts
    .command("update <contact-id>")
    .description("JSON-merge-patch update (pass the patch as JSON)")
    .requiredOption("--json <payload>", "JSON patch matching UpdateContactOptions")
    .action(
      withErrorHandler(async function (
        this: Command,
        contactId: string,
        cmdOpts: { json: string },
      ) {
        const opts = getGlobalOpts(this);
        const patch = parseJsonArg<Record<string, unknown>>(cmdOpts.json, "--json patch");
        const inkbox = createClient(opts);
        const contact = await inkbox.contacts.update(contactId, patch);
        output(contact as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  contacts
    .command("delete <contact-id>")
    .description("Delete a contact")
    .action(
      withErrorHandler(async function (this: Command, contactId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.contacts.delete(contactId);
        console.log(`Deleted contact ${contactId}.`);
      }),
    );

  contacts
    .command("lookup")
    .description("Reverse-lookup contacts (exactly one filter required)")
    .option("--email <email>", "Exact email match")
    .option("--email-contains <substr>", "Case-insensitive email substring")
    .option("--email-domain <domain>", "Domain-part match")
    .option("--phone <e164>", "Exact phone match")
    .option("--phone-contains <substr>", "Phone substring")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          email?: string;
          emailContains?: string;
          emailDomain?: string;
          phone?: string;
          phoneContains?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rows = await inkbox.contacts.lookup(cmdOpts);
        output(rows, {
          json: !!opts.json,
          columns: ["id", "preferredName", "givenName", "familyName", "updatedAt"],
        });
      }),
    );

  contacts
    .command("import <file>")
    .description("Bulk vCard import (text/vcard, ≤5 MiB, ≤1000 cards)")
    .action(
      withErrorHandler(async function (this: Command, file: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const body = readFileSync(file, "utf8");
        const result = await inkbox.contacts.vcards.import(body);
        output(result as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  contacts
    .command("export <contact-id>")
    .description("Export a single contact as vCard 4.0")
    .option("--out <file>", "Write to file instead of stdout")
    .action(
      withErrorHandler(async function (
        this: Command,
        contactId: string,
        cmdOpts: { out?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const vcf = await inkbox.contacts.vcards.export(contactId);
        if (cmdOpts.out) {
          writeFileSync(cmdOpts.out, vcf, "utf8");
          if (!opts.json) console.log(`Wrote ${cmdOpts.out}`);
        } else {
          if (opts.json) {
            output({ vcard: vcf }, { json: true });
          } else {
            process.stdout.write(vcf);
          }
        }
      }),
    );

  registerContactsAccessCommands(contacts);
}
