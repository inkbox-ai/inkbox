import { Command } from "commander";
import {
  ContactRuleStatus,
  FilterMode,
  PhoneRuleAction,
  PhoneRuleMatchType,
} from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

function renderFilterModeChangeNotice(
  pn: { filterModeChangeNotice?: unknown },
): void {
  const notice = pn.filterModeChangeNotice as {
    redundantRuleCount: number;
    redundantRuleAction: string;
    newFilterMode: string;
  } | null | undefined;
  if (!notice) return;
  console.error(
    `Note: ${notice.redundantRuleCount} active '${notice.redundantRuleAction}' ` +
      `rule(s) are now redundant under '${notice.newFilterMode}'. ` +
      `Review with 'inkbox number rules list --number <id>'.`,
  );
}

function assertFilterMode(raw: string): FilterMode {
  if (raw !== FilterMode.WHITELIST && raw !== FilterMode.BLACKLIST) {
    throw new Error(`--filter-mode must be 'whitelist' or 'blacklist' (got '${raw}')`);
  }
  return raw;
}

function registerNumberRulesCommands(parent: Command): void {
  const rules = parent
    .command("rules")
    .description("Contact rules scoped to a phone number");

  rules
    .command("list")
    .description("List rules for a number, or org-wide with --all-numbers")
    .option("--number <id>", "Phone number id")
    .option("--all-numbers", "List all rules across all numbers (admin-only)")
    .option("--phone-number-id <id>", "Narrow the org-wide list to a single number id")
    .option("--action <action>", "Filter by action: allow or block")
    .option("--match-type <type>", "Filter by match_type: exact_number")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10))
    .option("--offset <n>", "Offset", (v) => parseInt(v, 10))
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          number?: string;
          allNumbers?: boolean;
          phoneNumberId?: string;
          action?: string;
          matchType?: string;
          limit?: number;
          offset?: number;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        let rows;
        if (cmdOpts.allNumbers) {
          rows = await inkbox.phoneContactRules.listAll({
            phoneNumberId: cmdOpts.phoneNumberId,
            action: cmdOpts.action as PhoneRuleAction | undefined,
            matchType: cmdOpts.matchType as PhoneRuleMatchType | undefined,
            limit: cmdOpts.limit,
            offset: cmdOpts.offset,
          });
        } else {
          if (!cmdOpts.number) {
            throw new Error("--number <id> or --all-numbers is required");
          }
          rows = await inkbox.phoneContactRules.list(cmdOpts.number, {
            action: cmdOpts.action as PhoneRuleAction | undefined,
            matchType: cmdOpts.matchType as PhoneRuleMatchType | undefined,
            limit: cmdOpts.limit,
            offset: cmdOpts.offset,
          });
        }
        output(rows, {
          json: !!opts.json,
          columns: ["id", "phoneNumberId", "action", "matchType", "matchTarget", "status"],
        });
      }),
    );

  rules
    .command("get <rule-id>")
    .description("Get a single rule")
    .requiredOption("--number <id>", "Phone number id")
    .action(
      withErrorHandler(async function (
        this: Command,
        ruleId: string,
        cmdOpts: { number: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.phoneContactRules.get(cmdOpts.number, ruleId);
        output(rule as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  rules
    .command("create")
    .description("Create a rule")
    .requiredOption("--number <id>", "Phone number id")
    .requiredOption("--action <action>", "allow or block")
    .requiredOption("--match-target <value>", "Phone number to match (E.164)")
    .option("--match-type <type>", "exact_number (default)", PhoneRuleMatchType.EXACT_NUMBER)
    .option("--status <status>", "active (default) or paused")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          number: string;
          action: string;
          matchType: string;
          matchTarget: string;
          status?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.phoneContactRules.create(cmdOpts.number, {
          action: cmdOpts.action as PhoneRuleAction,
          matchType: cmdOpts.matchType as PhoneRuleMatchType,
          matchTarget: cmdOpts.matchTarget,
          status: cmdOpts.status as ContactRuleStatus | undefined,
        });
        output(rule as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  rules
    .command("update <rule-id>")
    .description("Update action and/or status on a rule (admin-only)")
    .requiredOption("--number <id>", "Phone number id")
    .option("--action <action>", "allow or block")
    .option("--status <status>", "active or paused")
    .action(
      withErrorHandler(async function (
        this: Command,
        ruleId: string,
        cmdOpts: { number: string; action?: string; status?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.phoneContactRules.update(cmdOpts.number, ruleId, {
          action: cmdOpts.action as PhoneRuleAction | undefined,
          status: cmdOpts.status as ContactRuleStatus | undefined,
        });
        output(rule as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  rules
    .command("delete <rule-id>")
    .description("Delete a rule (admin-only)")
    .requiredOption("--number <id>", "Phone number id")
    .action(
      withErrorHandler(async function (
        this: Command,
        ruleId: string,
        cmdOpts: { number: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.phoneContactRules.delete(cmdOpts.number, ruleId);
        console.log(`Deleted phone contact rule '${ruleId}' on ${cmdOpts.number}.`);
      }),
    );
}

export function registerNumberCommands(program: Command): void {
  const number = program
    .command("number")
    .description("Org-level phone number operations");

  number
    .command("list")
    .description("List all phone numbers")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const numbers = await inkbox.phoneNumbers.list();
        output(numbers, {
          json: !!opts.json,
          columns: ["number", "id", "type", "status", "filterMode", "agentIdentityId", "createdAt"],
        });
      }),
    );

  number
    .command("provision")
    .description("Provision a new phone number")
    .requiredOption("--handle <handle>", "Agent handle to provision for")
    .option("--type <type>", "Number type: toll_free or local", "toll_free")
    .option("--state <state>", "US state abbreviation (for local numbers)")
    .option("--incoming-text-webhook-url <url>", "Webhook URL for incoming text messages")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { handle: string; type: string; state?: string; incomingTextWebhookUrl?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const num = await inkbox.phoneNumbers.provision({
          agentHandle: cmdOpts.handle,
          type: cmdOpts.type,
          state: cmdOpts.state,
          incomingTextWebhookUrl: cmdOpts.incomingTextWebhookUrl,
        });
        output(
          {
            number: num.number,
            id: num.id,
            type: num.type,
            status: num.status,
            filterMode: num.filterMode,
            agentIdentityId: num.agentIdentityId,
          },
          { json: !!opts.json },
        );
      }),
    );

  number
    .command("get <id>")
    .description("Get phone number details")
    .action(
      withErrorHandler(async function (this: Command, id: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const num = await inkbox.phoneNumbers.get(id);
        output(
          {
            number: num.number,
            id: num.id,
            type: num.type,
            status: num.status,
            incomingCallAction: num.incomingCallAction ?? null,
            clientWebsocketUrl: num.clientWebsocketUrl ?? null,
            incomingCallWebhookUrl: num.incomingCallWebhookUrl ?? null,
            incomingTextWebhookUrl: num.incomingTextWebhookUrl ?? null,
            filterMode: num.filterMode,
            agentIdentityId: num.agentIdentityId,
            createdAt: num.createdAt,
          },
          { json: !!opts.json },
        );
      }),
    );

  number
    .command("update <id>")
    .description("Update phone number configuration")
    .option(
      "--incoming-call-action <action>",
      "Incoming call action: auto_accept, auto_reject, or webhook",
    )
    .option("--client-websocket-url <url>", "Client WebSocket URL for audio bridging")
    .option("--incoming-call-webhook-url <url>", "Webhook URL for incoming calls")
    .option("--incoming-text-webhook-url <url>", "Webhook URL for incoming text messages")
    .option("--filter-mode <mode>", "Contact-rule filter mode: whitelist or blacklist (admin-only)")
    .action(
      withErrorHandler(async function (
        this: Command,
        id: string,
        cmdOpts: {
          incomingCallAction?: string;
          clientWebsocketUrl?: string;
          incomingCallWebhookUrl?: string;
          incomingTextWebhookUrl?: string;
          filterMode?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const num = await inkbox.phoneNumbers.update(id, {
          incomingCallAction: cmdOpts.incomingCallAction,
          clientWebsocketUrl: cmdOpts.clientWebsocketUrl,
          incomingCallWebhookUrl: cmdOpts.incomingCallWebhookUrl,
          incomingTextWebhookUrl: cmdOpts.incomingTextWebhookUrl,
          filterMode:
            cmdOpts.filterMode !== undefined
              ? assertFilterMode(cmdOpts.filterMode)
              : undefined,
        });
        output(
          {
            number: num.number,
            id: num.id,
            type: num.type,
            status: num.status,
            incomingCallAction: num.incomingCallAction ?? null,
            clientWebsocketUrl: num.clientWebsocketUrl ?? null,
            incomingCallWebhookUrl: num.incomingCallWebhookUrl ?? null,
            incomingTextWebhookUrl: num.incomingTextWebhookUrl ?? null,
            filterMode: num.filterMode,
            agentIdentityId: num.agentIdentityId,
          },
          { json: !!opts.json },
        );
        renderFilterModeChangeNotice(num);
      }),
    );

  number
    .command("release <id>")
    .description("Release a phone number")
    .action(
      withErrorHandler(async function (this: Command, id: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.phoneNumbers.release(id);
        console.log(`Released phone number '${id}'.`);
      }),
    );

  registerNumberRulesCommands(number);
}
