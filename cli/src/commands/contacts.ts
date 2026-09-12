import { Command, Option } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import type {
  ContactFactKind,
  ContactReviewStatus,
  CorrespondenceChannel,
  CorrespondenceContentMode,
  CorrespondenceOrder,
  CorrespondenceTranscriptMode,
  CreateContactOptions,
  MergeContactsOptions,
  ReplaceContactCommunicationPolicy,
} from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import { parsePolicyPagination } from "../pagination.js";

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

/** Validate objects before serialization can discard unrecognized settings. */
function policyObject(value: unknown, fields: string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !fields.includes(key));
  if (unknown.length) throw new Error(`Unknown field in ${path}: ${unknown.join(", ")}`);
  return record;
}

/** Validate a complete communication or visibility portion. */
function validatePolicyPortion(defaults: unknown, identities: unknown, fields: string[], path: string): void {
  const validateDecisions = (row: Record<string, unknown>, label: string): void => {
    for (const key of fields) {
      if (!["inherit", "allow", "block"].includes(row[key] as string)) throw new Error(`${label}.${key} must be inherit, allow, or block`);
    }
  };
  validateDecisions(policyObject(defaults, fields, `${path}.defaults`), `${path}.defaults`);
  if (!Array.isArray(identities)) throw new Error(`${path}.identities must be an array`);
  if (identities.length > 500) throw new Error(`${path}.identities cannot exceed 500 entries`);
  const seen = new Set<string>();
  for (const [index, value] of identities.entries()) {
    const label = `${path}.identities[${index}]`;
    const row = policyObject(value, ["identityId", ...fields], label);
    if (typeof row.identityId !== "string" || !row.identityId) throw new Error(`${label}.identityId is required`);
    if (seen.has(row.identityId)) throw new Error(`${path}.identities contains duplicate identities`);
    seen.add(row.identityId);
    validateDecisions(row, label);
  }
}

/** Parse a policy file while preserving omission of visibility settings. */
export function parseContactPolicyFile(raw: string): ReplaceContactCommunicationPolicy {
  const body = policyObject(parseJsonArg<unknown>(raw, "policy file"), ["expectedRevision", "defaults", "identities", "visibility"], "policy");
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) throw new Error("policy.expectedRevision must be a nonnegative integer");
  validatePolicyPortion(body.defaults, body.identities, ["email", "phone"], "policy");
  if (Object.hasOwn(body, "visibility")) {
    const visibility = policyObject(body.visibility, ["defaults", "identities"], "policy.visibility");
    validatePolicyPortion(visibility.defaults, visibility.identities, ["profile", "memories"], "policy.visibility");
  }
  return body as unknown as ReplaceContactCommunicationPolicy;
}

function registerContactsAccessCommands(parent: Command): void {
  const policy = parent.command("communication-policy").description("Contact communication lists and previews");
  policy.command("list-management <handle>").description("Manage contact permissions, including hidden contacts (admin credentials)")
    .option("--q <query>", "Search contact details")
    .option("--limit <number>", "Page size", "50").option("--offset <number>", "Page offset", "0")
    .addOption(new Option("--order <order>", "Sort order").choices(["name", "recent"]).default("recent"))
    .addOption(new Option("--review-status <status...>", "Contact review states").choices(["confirmed", "unreviewed"]))
    .action(withErrorHandler(async function (this: Command, handle: string, options: {
      q?: string; limit: string; offset: string; order: "name" | "recent"; reviewStatus?: ContactReviewStatus[];
    }): Promise<void> {
      const opts = getGlobalOpts(this);
      const page = await createClient(opts).contacts.communicationPolicy.listManagementForIdentity(handle, {
        ...options, ...parsePolicyPagination(options),
      });
      output(opts.json ? page : page.items.map((row) => ({ id: row.contact.id, contact: row.contact.preferredName,
        ...row.effective, revision: row.revision })),
      { json: !!opts.json, columns: ["id", "contact", "email", "phone", "profile", "memories", "revision"] });
    }));
  policy.command("get <contact-id>").description("Read a contact policy (admin credentials)")
    .action(withErrorHandler(async function (this: Command, contactId: string): Promise<void> {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).contacts.communicationPolicy.get(contactId) as unknown as Record<string, unknown>, { json: !!opts.json });
    }));
  policy.command("set <contact-id>").description("Replace a contact policy (admin credentials)")
    .requiredOption("--file <path>", "JSON file with expectedRevision, defaults, identities, and optional visibility")
    .action(withErrorHandler(async function (this: Command, contactId: string, options: { file: string }): Promise<void> {
      const opts = getGlobalOpts(this);
      const body = parseContactPolicyFile(readFileSync(options.file, "utf8"));
      output(await createClient(opts).contacts.communicationPolicy.replace(contactId, body) as unknown as Record<string, unknown>, { json: !!opts.json });
    }));
  policy.command("preview <contact-id> <identity-id>").description("Preview contact visibility (admin credentials)")
    .action(withErrorHandler(async function (this: Command, contactId: string, identityId: string): Promise<void> {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).contacts.communicationPolicy.preview(contactId, identityId) as unknown as Record<string, unknown>, { json: !!opts.json });
    }));
  policy.command("list <handle>").description("List an identity's visible contact permissions")
    .option("--limit <number>", "Page size", "50").option("--offset <number>", "Page offset", "0")
    .action(withErrorHandler(async function (this: Command, handle: string, options: { limit: string; offset: string }): Promise<void> {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).contacts.communicationPolicy.listForIdentity(handle, parsePolicyPagination(options)) as unknown as Record<string, unknown>, { json: !!opts.json });
    }));

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

const FACT_KINDS: ContactFactKind[] = ["profile", "preference", "context"];

function parseFactKind(value: string): ContactFactKind {
  if (!(FACT_KINDS as string[]).includes(value)) {
    throw new Error(`--kind must be one of: ${FACT_KINDS.join(", ")}`);
  }
  return value as ContactFactKind;
}

function registerContactFactsCommands(parent: Command): void {
  const facts = parent.command("facts").description("Contact memory facts and citations");

  facts
    .command("list <contact-id>")
    .description("List a contact's facts")
    .option(
      "--include-expired",
      "Also list expired context facts (locked facts remain active)",
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        contactId: string,
        cmdOpts: { includeExpired?: boolean },
      ) {
        const opts = getGlobalOpts(this);
        const rows = await createClient(opts).contacts.facts.list(contactId, {
          includeExpired: !!cmdOpts.includeExpired,
        });
        output(rows, {
          json: !!opts.json,
          columns: ["id", "kind", "content", "origin", "confidence", "expiresAt", "updatedAt"],
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

  facts
    .command("citation-url <source-url>")
    .description("Resolve an available fact citation URL")
    .action(
      withErrorHandler(async function (this: Command, sourceUrl: string) {
        const opts = getGlobalOpts(this);
        const citation = await createClient(opts).contacts.facts.resolveCitationUrl(sourceUrl);
        output(citation as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  facts
    .command("create <contact-id>")
    .description(
      "Record a fact by hand (admin-scoped API key required; hand-written facts never expire)",
    )
    .requiredOption("--content <text>", "What to remember about the contact")
    .requiredOption("--kind <kind>", "profile, preference, or context")
    .action(
      withErrorHandler(async function (
        this: Command,
        contactId: string,
        cmdOpts: { content: string; kind: string },
      ) {
        const opts = getGlobalOpts(this);
        const fact = await createClient(opts).contacts.facts.create(contactId, {
          content: cmdOpts.content,
          kind: parseFactKind(cmdOpts.kind),
        });
        output(fact as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  facts
    .command("update <contact-id> <fact-id>")
    .description(
      "Edit a fact (admin-scoped API key required; any edit makes it manually maintained and revives it; content changes remove citations)",
    )
    .option("--content <text>", "Replacement content")
    .option("--kind <kind>", "profile, preference, or context")
    .action(
      withErrorHandler(async function (
        this: Command,
        contactId: string,
        factId: string,
        cmdOpts: { content?: string; kind?: string },
      ) {
        const opts = getGlobalOpts(this);
        if (cmdOpts.content === undefined && cmdOpts.kind === undefined) {
          throw new Error("Pass --content, --kind, or both");
        }
        const fact = await createClient(opts).contacts.facts.update(contactId, factId, {
          content: cmdOpts.content,
          kind: cmdOpts.kind === undefined ? undefined : parseFactKind(cmdOpts.kind),
        });
        output(fact as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  facts
    .command("delete <contact-id> <fact-id>")
    .description("Delete a contact fact (admin-scoped API key required)")
    .action(
      withErrorHandler(async function (this: Command, contactId: string, factId: string) {
        const opts = getGlobalOpts(this);
        const result = await createClient(opts).contacts.facts.delete(contactId, factId);
        output(result as unknown as Record<string, unknown>, { json: !!opts.json });
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
      "Filter by confirmed or unreviewed (repeat or comma-separate)",
      collectValues,
    )
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10))
    .option("--offset <n>", "Offset (0-10000)", (v) => parseInt(v, 10))
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
            "memoryCount",
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
        const contact = await createClient(opts).contacts.get(contactId);
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
    .description(
      "Merge contacts (admin-scoped key required; rejected when a memory kind or total goes over; delete from named kinds, or any active fact for total)",
    )
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
    .requiredOption("--json <payload>", "JSON payload matching CreateContactOptions; optional permissions require an admin API key")
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
    .command("bulk-delete <contact-id...>")
    .description("Delete multiple contacts")
    .action(
      withErrorHandler(async function (this: Command, contactIds: string[]) {
        const opts = getGlobalOpts(this);
        const result = await createClient(opts).contacts.bulkDelete(contactIds);
        output(result as unknown as Record<string, unknown>, { json: !!opts.json });
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
        const result = await inkbox.contacts.vcards.import(body, "text/vcard");
        output(result as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  contacts
    .command("export-many <contact-id...>")
    .description("Export up to 25 contacts as one vCard document")
    .option("--out <file>", "Write to file instead of stdout")
    .action(
      withErrorHandler(async function (
        this: Command,
        contactIds: string[],
        cmdOpts: { out?: string },
      ) {
        const opts = getGlobalOpts(this);
        const result = await createClient(opts).contacts.vcards.exportMany(contactIds);
        if (cmdOpts.out) {
          writeFileSync(cmdOpts.out, result.vcard, "utf8");
          if (!opts.json) console.log(`Wrote ${cmdOpts.out}`);
        } else if (opts.json) {
          output(result as unknown as Record<string, unknown>, { json: true });
        } else {
          process.stdout.write(result.vcard);
        }
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
