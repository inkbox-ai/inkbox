import { Command } from "commander";
import {
  FilterMode,
  MailRuleAction,
  MailRuleMatchType,
  ContactRuleStatus,
} from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

const MAILBOX_LIST_COLUMNS = [
  "emailAddress",
  "id",
  "displayName",
  "filterMode",
  "agentIdentityId",
  "createdAt",
];

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
    .description("Contact rules scoped to a mailbox");

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
    .description("Update action and/or status on a rule (admin-only)")
    .requiredOption("--mailbox <email>", "Mailbox email address")
    .option("--action <action>", "allow or block")
    .option("--status <status>", "active or paused")
    .action(
      withErrorHandler(async function (
        this: Command,
        ruleId: string,
        cmdOpts: { mailbox: string; action?: string; status?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.mailContactRules.update(cmdOpts.mailbox, ruleId, {
          action: cmdOpts.action as MailRuleAction | undefined,
          status: cmdOpts.status as ContactRuleStatus | undefined,
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
        output(mailboxes, {
          json: !!opts.json,
          columns: MAILBOX_LIST_COLUMNS,
        });
      }),
    );

  mailbox
    .command("create")
    .description("Create a mailbox")
    .requiredOption("-i, --identity <handle>", "Agent identity handle to link the mailbox to")
    .option("--display-name <name>", "Display name for the mailbox")
    .option("--local-part <part>", "Requested email local part (random if omitted)")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          displayName?: string;
          localPart?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const mb = await inkbox.mailboxes.create({
          agentHandle: cmdOpts.identity,
          displayName: cmdOpts.displayName,
          emailLocalPart: cmdOpts.localPart,
        });
        output(
          {
            emailAddress: mb.emailAddress,
            id: mb.id,
            displayName: mb.displayName,
            filterMode: mb.filterMode,
            agentIdentityId: mb.agentIdentityId,
            createdAt: mb.createdAt,
          },
          { json: !!opts.json },
        );
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
        output(
          {
            emailAddress: mb.emailAddress,
            id: mb.id,
            displayName: mb.displayName,
            webhookUrl: mb.webhookUrl ?? null,
            filterMode: mb.filterMode,
            agentIdentityId: mb.agentIdentityId,
            createdAt: mb.createdAt,
          },
          { json: !!opts.json },
        );
      }),
    );

  mailbox
    .command("update <email-address>")
    .description("Update a mailbox")
    .option("--display-name <name>", "New display name")
    .option("--webhook-url <url>", 'Webhook URL (pass "" to clear)')
    .option("--filter-mode <mode>", "Contact-rule filter mode: whitelist or blacklist (admin-only)")
    .action(
      withErrorHandler(async function (
        this: Command,
        emailAddress: string,
        cmdOpts: { displayName?: string; webhookUrl?: string; filterMode?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const mb = await inkbox.mailboxes.update(emailAddress, {
          displayName: cmdOpts.displayName,
          webhookUrl:
            cmdOpts.webhookUrl === "" ? null : cmdOpts.webhookUrl,
          filterMode:
            cmdOpts.filterMode !== undefined
              ? assertFilterMode(cmdOpts.filterMode)
              : undefined,
        });
        output(
          {
            emailAddress: mb.emailAddress,
            id: mb.id,
            displayName: mb.displayName,
            webhookUrl: mb.webhookUrl ?? null,
            filterMode: mb.filterMode,
            agentIdentityId: mb.agentIdentityId,
          },
          { json: !!opts.json },
        );
        renderFilterModeChangeNotice(mb);
      }),
    );

  mailbox
    .command("delete <email-address>")
    .description("Delete a mailbox")
    .action(
      withErrorHandler(async function (
        this: Command,
        emailAddress: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.mailboxes.delete(emailAddress);
        console.log(`Deleted mailbox '${emailAddress}'.`);
      }),
    );

  registerMailboxRulesCommands(mailbox);
}
