import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import type {
  ContactReviewStatus,
  CorrespondenceChannel,
  CorrespondenceContentMode,
  CorrespondenceOrder,
  CorrespondenceTranscriptMode,
  CreateContactOptions,
  MergeContactsOptions,
} from "@inkbox/sdk";
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

function collectValues(value: string, previous: string[] = []): string[] {
  return [
    ...previous,
    ...value.split(",").map((part) => part.trim()).filter(Boolean),
  ];
}

function registerContactsAccessCommands(parent: Command): void {
  const access = parent
    .command("access")
    .description("Compatibility access view");

  access
    .command("list <contact-id>")
    .description("List compatibility access rows on a contact")
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

}

function registerContactFactsCommands(parent: Command): void {
  const facts = parent.command("facts").description("Contact memory facts and citations");

  facts
    .command("list <contact-id>")
    .description("List active facts for a contact")
    .action(
      withErrorHandler(async function (this: Command, contactId: string) {
        const opts = getGlobalOpts(this);
        const rows = await createClient(opts).contacts.facts.list(contactId);
        output(rows, {
          json: !!opts.json,
          columns: ["id", "content", "origin", "confidence", "updatedAt"],
        });
      }),
    );

  facts
    .command("get <contact-id> <fact-id>")
    .description("Fetch a contact fact")
    .action(
      withErrorHandler(async function (this: Command, contactId: string, factId: string) {
        const opts = getGlobalOpts(this);
        const fact = await createClient(opts).contacts.facts.get(contactId, factId);
        output(fact as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  facts
    .command("citation <contact-id> <fact-id> <citation-id>")
    .description("Resolve a fact citation")
    .action(
      withErrorHandler(async function (
        this: Command,
        contactId: string,
        factId: string,
        citationId: string,
      ) {
        const opts = getGlobalOpts(this);
        const citation = await createClient(opts).contacts.facts.resolveCitation(
          contactId,
          factId,
          citationId,
        );
        output(citation as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );
}

export function registerContactsCommands(program: Command): void {
  const contacts = program
    .command("contacts")
    .description("Org-wide contacts, memory, correspondence, and vCard");

  contacts
    .command("list")
    .description("List contacts")
    .option("--q <query>", "Case-insensitive substring search (≤100 chars)")
    .option("--order <order>", "name or recent")
    .option(
      "--review-status <status>",
      "Filter by confirmed, unreviewed, or dismissed (repeat or comma-separate)",
      collectValues,
    )
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10))
    .option("--offset <n>", "Offset", (v) => parseInt(v, 10))
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          q?: string;
          order?: string;
          reviewStatus?: string[];
          limit?: number;
          offset?: number;
        },
      ) {
        const opts = getGlobalOpts(this);
        const rows = await createClient(opts).contacts.list({
          ...cmdOpts,
          reviewStatus: cmdOpts.reviewStatus as ContactReviewStatus[] | undefined,
        });
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
    .option("--include-dismissed", "Include a dismissed contact", false)
    .action(
      withErrorHandler(async function (
        this: Command,
        contactId: string,
        cmdOpts: { includeDismissed?: boolean },
      ) {
        const opts = getGlobalOpts(this);
        const contact = await createClient(opts).contacts.get(contactId, cmdOpts);
        output(contact as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  contacts
    .command("correspondence <contact-id>")
    .description("List correspondence with a contact across channels")
    .option("-i, --identity <uuid>", "Agent identity UUID")
    .option("--channels <channel>", "Channels to include (repeat or comma-separate)", collectValues)
    .option("--after <datetime>", "Only items at or after this time")
    .option("--before <datetime>", "Only items before this time")
    .option("--limit-per-channel <n>", "Default limit per channel", (v) => parseInt(v, 10))
    .option("--email-limit <n>", "Email limit", (v) => parseInt(v, 10))
    .option("--sms-limit <n>", "SMS limit", (v) => parseInt(v, 10))
    .option("--imessage-limit <n>", "iMessage limit", (v) => parseInt(v, 10))
    .option("--calls-limit <n>", "Call limit", (v) => parseInt(v, 10))
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--order <order>", "asc or desc")
    .option("--content <mode>", "metadata, preview, or full")
    .option("--transcripts <mode>", "none, abridged, or full")
    .option("--include-failed", "Include failed correspondence", false)
    .option("--include-dismissed", "Include a dismissed contact", false)
    .action(
      withErrorHandler(async function (
        this: Command,
        contactId: string,
        cmdOpts: {
          identity?: string;
          channels?: string[];
          after?: string;
          before?: string;
          limitPerChannel?: number;
          emailLimit?: number;
          smsLimit?: number;
          imessageLimit?: number;
          callsLimit?: number;
          cursor?: string;
          order?: string;
          content?: string;
          transcripts?: string;
          includeFailed?: boolean;
          includeDismissed?: boolean;
        },
      ) {
        const opts = getGlobalOpts(this);
        const { identity, ...correspondenceOptions } = cmdOpts;
        const result = await createClient(opts).contacts.correspondence.get(contactId, {
          ...correspondenceOptions,
          channels: cmdOpts.channels as CorrespondenceChannel[] | undefined,
          order: cmdOpts.order as CorrespondenceOrder | undefined,
          content: cmdOpts.content as CorrespondenceContentMode | undefined,
          transcripts: cmdOpts.transcripts as CorrespondenceTranscriptMode | undefined,
          identityId: identity,
        });
        output(result as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  contacts
    .command("merge <contact-id>")
    .description("Merge contacts into the surviving contact")
    .requiredOption("--losing <contact-id...>", "Contact IDs to merge into the survivor")
    .option("--field-sources <json>", "JSON object mapping profile fields to source contact IDs")
    .action(
      withErrorHandler(async function (
        this: Command,
        contactId: string,
        cmdOpts: { losing: string[]; fieldSources?: string },
      ) {
        const opts = getGlobalOpts(this);
        const fieldSources = cmdOpts.fieldSources
          ? parseJsonArg<MergeContactsOptions["fieldSources"]>(
              cmdOpts.fieldSources,
              "--field-sources",
            )
          : undefined;
        const result = await createClient(opts).contacts.merge(contactId, {
          losingContactIds: cmdOpts.losing,
          fieldSources,
        });
        output(result as unknown as Record<string, unknown>, { json: !!opts.json });
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
  registerContactFactsCommands(contacts);
}
