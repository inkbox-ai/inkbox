import { Command } from "commander";
import {
  FilterMode,
  MailRuleAction,
  MailRuleMatchType,
} from "@inkbox/sdk";
import type { Mailbox } from "@inkbox/sdk";
import { createClient, getGlobalOpts, resolveBaseUrl } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

const MAILBOX_LIST_COLUMNS = [
  "emailAddress",
  "sendingDomain",
  "storage",
  "id",
  "filterMode",
  "agentIdentityId",
  "createdAt",
];

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];

// Storage caps are binary (2 GiB = 2 * 1024 ** 3), so this divides by 1024 and
// labels GiB/MiB — never pair base-2 math with a decimal "GB".
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  let rounded = Math.round(value * 10) / 10;
  if (rounded >= 1024 && unit < BYTE_UNITS.length - 1) {
    rounded = Math.round((rounded / 1024) * 10) / 10;
    unit += 1;
  }
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

/** "1.2 GiB / 4 GiB"; a null limit (unresolved cap) renders as a dash. */
export function formatStorage(used: number, limit: number | null): string {
  const usedText = formatBytes(used ?? 0);
  return `${usedText} / ${limit === null || limit === undefined ? "-" : formatBytes(limit)}`;
}

export function mailboxListRow(mb: Mailbox): Record<string, unknown> {
  return {
    ...mb,
    storage: formatStorage(mb.storageUsedBytes, mb.storageLimitBytes),
  };
}

/** `humanize` adds the readable `storage` line; --json gets raw bytes only. */
export function mailboxGetRecord(
  mb: Mailbox,
  opts: { humanize: boolean },
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    emailAddress: mb.emailAddress,
    sendingDomain: mb.sendingDomain,
    id: mb.id,
    filterMode: mb.filterMode,
    agentIdentityId: mb.agentIdentityId,
    createdAt: mb.createdAt,
    storageUsedBytes: mb.storageUsedBytes,
    storageLimitBytes: mb.storageLimitBytes,
  };
  if (opts.humanize) {
    record.storage = formatStorage(mb.storageUsedBytes, mb.storageLimitBytes);
  }
  return record;
}

const MAIL_DOMAIN_BY_API_HOST = new Map([
  ["inkbox.ai", "inkboxmail.com"],
  ["api.inkbox.ai", "inkboxmail.com"],
  ["beta.inkbox.ai", "beta.inkboxmail.com"],
  ["api.beta.inkbox.ai", "beta.inkboxmail.com"],
  ["development.inkbox.ai", "development.inkboxmail.com"],
  ["api.development.inkbox.ai", "development.inkboxmail.com"],
]);

export const UNRESOLVED_MAIL_HOSTS_ERROR =
  "Can't determine the mail hosts for this API base URL.";

/**
 * The mail domain for the configured API base URL, or null when the URL isn't an
 * Inkbox API host. Callers must print nothing on null — a mail client pointed at
 * guessed hosts would talk to the wrong server.
 */
export function resolveMailDomain(baseUrl?: string): string | null {
  if (!baseUrl) return "inkboxmail.com"; // unset = the SDK's default API host
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  return MAIL_DOMAIN_BY_API_HOST.get(host) ?? null;
}

export function clientSettings(
  emailAddress: string,
  mailDomain: string,
): Record<string, unknown> {
  return {
    imapHost: `imap.${mailDomain}`,
    imapPort: 993,
    imapSecurity: "IMAPS (implicit TLS)",
    smtpHost: `smtp.${mailDomain}`,
    smtpPort: 465,
    smtpPortStarttls: 587,
    username: emailAddress,
    // Never printed: the caller supplies their own identity-scoped API key.
    password: "<your identity-scoped API key (ApiKey_...)>",
  };
}

function renderFilterModeChangeNotice(
  mb: { filterModeChangeNotice: unknown } | { filterModeChangeNotice?: unknown },
): void {
  const notice = (mb as { filterModeChangeNotice?: {
    redundantRuleCount: number;
    redundantRuleAction: string;
    newFilterMode: string;
  } | null }).filterModeChangeNotice;
  if (!notice) return;
  console.error(
    `Note: ${notice.redundantRuleCount} active '${notice.redundantRuleAction}' ` +
      `rule(s) are now redundant under '${notice.newFilterMode}'. ` +
      `Review with 'inkbox mailbox rules list --mailbox <email>'.`,
  );
}

function assertFilterMode(raw: string): FilterMode {
  if (raw !== FilterMode.WHITELIST && raw !== FilterMode.BLACKLIST) {
    throw new Error(`--filter-mode must be 'whitelist' or 'blacklist' (got '${raw}')`);
  }
  return raw;
}

function registerMailboxRulesCommands(parent: Command): void {
  const rules = parent
    .command("rules")
    .description(
      "[deprecated] Contact rules scoped to a mailbox. Use " +
        "'inkbox identity mail-rules ...' instead (keyed by agent handle).",
    );

  rules
    .command("list")
    .description("List rules for a mailbox, or org-wide with --all-mailboxes")
    .option("--mailbox <email>", "Mailbox email address")
    .option("--all-mailboxes", "List all rules across all mailboxes (admin-only)")
    .option("--mailbox-id <id>", "Narrow the org-wide list to a single mailbox id")
    .option("--action <action>", "Filter by action: allow or block")
    .option("--match-type <type>", "Filter by match_type: exact_email or domain")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10))
    .option("--offset <n>", "Offset", (v) => parseInt(v, 10))
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          mailbox?: string;
          allMailboxes?: boolean;
          mailboxId?: string;
          action?: string;
          matchType?: string;
          limit?: number;
          offset?: number;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        let rows;
        if (cmdOpts.allMailboxes) {
          rows = await inkbox.mailContactRules.listAll({
            mailboxId: cmdOpts.mailboxId,
            action: cmdOpts.action as MailRuleAction | undefined,
            matchType: cmdOpts.matchType as MailRuleMatchType | undefined,
            limit: cmdOpts.limit,
            offset: cmdOpts.offset,
          });
        } else {
          if (!cmdOpts.mailbox) {
            throw new Error("--mailbox <email> or --all-mailboxes is required");
          }
          rows = await inkbox.mailContactRules.list(cmdOpts.mailbox, {
            action: cmdOpts.action as MailRuleAction | undefined,
            matchType: cmdOpts.matchType as MailRuleMatchType | undefined,
            limit: cmdOpts.limit,
            offset: cmdOpts.offset,
          });
        }
        output(rows, {
          json: !!opts.json,
          columns: ["id", "mailboxId", "action", "matchType", "matchTarget", "status"],
        });
      }),
    );

  rules
    .command("get <rule-id>")
    .description("Get a single rule")
    .requiredOption("--mailbox <email>", "Mailbox email address")
    .action(
      withErrorHandler(async function (
        this: Command,
        ruleId: string,
        cmdOpts: { mailbox: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.mailContactRules.get(cmdOpts.mailbox, ruleId);
        output(rule as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  rules
    .command("create")
    .description("Create a rule (always starts active; use `update` to pause)")
    .requiredOption("--mailbox <email>", "Mailbox email address")
    .requiredOption("--action <action>", "allow or block")
    .requiredOption("--match-type <type>", "exact_email or domain")
    .requiredOption("--match-target <value>", "Address or domain to match")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          mailbox: string;
          action: string;
          matchType: string;
          matchTarget: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.mailContactRules.create(cmdOpts.mailbox, {
          action: cmdOpts.action as MailRuleAction,
          matchType: cmdOpts.matchType as MailRuleMatchType,
          matchTarget: cmdOpts.matchTarget,
        });
        output(rule as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  rules
    .command("update <rule-id>")
    .description("Update the action on a rule (admin-only)")
    .requiredOption("--mailbox <email>", "Mailbox email address")
    .requiredOption("--action <action>", "allow or block")
    .action(
      withErrorHandler(async function (
        this: Command,
        ruleId: string,
        cmdOpts: { mailbox: string; action: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.mailContactRules.update(cmdOpts.mailbox, ruleId, {
          action: cmdOpts.action as MailRuleAction,
        });
        output(rule as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  rules
    .command("delete <rule-id>")
    .description("Delete a rule (admin-only)")
    .requiredOption("--mailbox <email>", "Mailbox email address")
    .action(
      withErrorHandler(async function (
        this: Command,
        ruleId: string,
        cmdOpts: { mailbox: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.mailContactRules.delete(cmdOpts.mailbox, ruleId);
        console.log(`Deleted mail contact rule '${ruleId}' on ${cmdOpts.mailbox}.`);
      }),
    );
}

export function registerMailboxCommands(program: Command): void {
  const mailbox = program
    .command("mailbox")
    .description("Org-level mailbox operations");

  mailbox
    .command("list")
    .description("List all mailboxes")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const mailboxes = await inkbox.mailboxes.list();
        // --json keeps the raw byte counts; the table gets the humanized column.
        output(opts.json ? mailboxes : mailboxes.map(mailboxListRow), {
          json: !!opts.json,
          columns: MAILBOX_LIST_COLUMNS,
        });
      }),
    );

  mailbox
    .command("get <email-address>")
    .description("Get mailbox details")
    .action(
      withErrorHandler(async function (
        this: Command,
        emailAddress: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const mb = await inkbox.mailboxes.get(emailAddress);
        output(mailboxGetRecord(mb, { humanize: !opts.json }), {
          json: !!opts.json,
        });
      }),
    );

  mailbox
    .command("update <email-address>")
    .description(
      "Update a mailbox. Use 'inkbox identity update --display-name' " +
        "to rename — mailbox PATCH does not accept display_name.",
    )
    .option("--filter-mode <mode>", "Contact-rule filter mode: whitelist or blacklist (admin-only)")
    .action(
      withErrorHandler(async function (
        this: Command,
        emailAddress: string,
        cmdOpts: { filterMode?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const updateBody: { filterMode?: FilterMode } = {};
        if (cmdOpts.filterMode !== undefined) {
          updateBody.filterMode = assertFilterMode(cmdOpts.filterMode);
        }
        const mb = await inkbox.mailboxes.update(emailAddress, updateBody);
        output(
          {
            emailAddress: mb.emailAddress,
            id: mb.id,
            filterMode: mb.filterMode,
            agentIdentityId: mb.agentIdentityId,
          },
          { json: !!opts.json },
        );
        renderFilterModeChangeNotice(mb);
      }),
    );

  mailbox
    .command("client-settings <email-address>")
    .description(
      "Print IMAP/SMTP settings for attaching this inbox to a mail client",
    )
    .action(
      withErrorHandler(async function (this: Command, emailAddress: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const mailDomain = resolveMailDomain(resolveBaseUrl(opts));
        // Bail before printing anything rather than emit hosts we had to guess.
        if (!mailDomain) throw new Error(UNRESOLVED_MAIL_HOSTS_ERROR);
        // Fetch so a typo'd / foreign address fails as a normal API error.
        const mb = await inkbox.mailboxes.get(emailAddress);
        const settings = clientSettings(mb.emailAddress, mailDomain);
        output(settings, { json: !!opts.json });
        if (opts.json) return;
        console.log("");
        console.log(
          "Password: use an identity-scoped API key — mint one with " +
            "'inkbox api-keys create --label <name> --identity-id <uuid>'. " +
            "Admin-scoped keys are rejected (one key maps to one mailbox).",
        );
        console.log(
          `The message From must be exactly ${mb.emailAddress}; aliases and ` +
            "'send as' are rejected. On the Free plan, signed/encrypted mail " +
            "(S/MIME, PGP) cannot be sent over SMTP.",
        );
      }),
    );

  registerMailboxRulesCommands(mailbox);
}
