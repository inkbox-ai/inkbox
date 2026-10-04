import { Command, Option } from "commander";
import { SlackRuleAction, SlackRuleMatchType, type RuleDirection } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { withErrorHandler } from "../errors.js";
import { output } from "../output.js";

const direction = () => new Option("--direction <direction>", "Rule coverage").choices(["both", "inbound", "outbound"]);
const action = () => new Option("--action <action>", "Allow or block").choices(["allow", "block"]);
const match = () => new Option("--match-type <type>", "Person account or workspace").choices(["exact_user", "workspace"]);
function integer(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Expected a nonnegative integer");
  return Number(value);
}
interface RuleOptions {
  action?: SlackRuleAction; matchType?: SlackRuleMatchType; matchTarget?: string;
  direction?: RuleDirection; applyTo?: "inbound" | "outbound";
  agentIdentityId?: string; limit?: number; offset?: number;
}
export function registerSlackRuleCommands(slack: Command): void {
  const rules = slack.command("contact-rule").description("Manage Slack contact and workspace rules");
  rules.command("list <handle>").description("List one identity’s Slack contact rules").addOption(action()).addOption(match()).addOption(direction())
    .option("--limit <n>", "Page size", integer).option("--offset <n>", "Page offset", integer)
    .action(withErrorHandler(async function (this: Command, handle: string, options: RuleOptions) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).slack.contactRules.list(handle, options), { json: !!opts.json });
    }));
  rules.command("list-all").description("List Slack contact rules across the organization").addOption(action()).addOption(match()).addOption(direction())
    .option("--agent-identity-id <id>", "Filter by owning identity UUID")
    .option("--limit <n>", "Page size", integer).option("--offset <n>", "Page offset", integer)
    .action(withErrorHandler(async function (this: Command, options: RuleOptions) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).slack.contactRules.listAll(options), { json: !!opts.json });
    }));
  rules.command("get <handle> <rule-id>").description("Get a Slack contact rule")
    .action(withErrorHandler(async function (this: Command, handle: string, id: string) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).slack.contactRules.get(handle, id), { json: !!opts.json });
    }));
  rules.command("create <handle>").description("Create a Slack person or workspace rule (admin required)").addOption(action().makeOptionMandatory())
    .addOption(match().default("exact_user")).addOption(direction())
    .requiredOption("--match-target <target>", "Verified workspace:user account or workspace ID")
    .action(withErrorHandler(async function (this: Command, handle: string, options: RuleOptions) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).slack.contactRules.create(handle, {
        action: options.action!, matchType: options.matchType, matchTarget: options.matchTarget!, direction: options.direction,
      }), { json: !!opts.json });
    }));
  rules.command("update <handle> <rule-id>").description("Update a Slack contact rule (admin required)").addOption(action()).addOption(direction())
    .addOption(new Option("--apply-to <direction>", "Change the action on one covered side").choices(["inbound", "outbound"]))
    .action(withErrorHandler(async function (this: Command, handle: string, id: string, options: RuleOptions) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).slack.contactRules.update(handle, id, options), { json: !!opts.json });
    }));
  rules.command("delete <handle> <rule-id>").description("Delete a Slack contact rule (admin required)")
    .action(withErrorHandler(async function (this: Command, handle: string, id: string) {
      const opts = getGlobalOpts(this);
      await createClient(opts).slack.contactRules.delete(handle, id);
      output({ deleted: true }, { json: !!opts.json });
    }));
  slack.command("contacts-import").description("Import one page of visible people (organization admin required); does not allow them")
    .requiredOption("--connection-id <id>", "Workspace connection UUID")
    .option("--conversation-id <id>", "Import visible members of this conversation instead of the workspace directory")
    .option("--limit <n>", "Page size", integer).option("--cursor <cursor>", "Continuation cursor")
    .action(withErrorHandler(async function (this: Command, options: { connectionId: string; conversationId?: string; limit?: number; cursor?: string }) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).slack.importContacts(options.connectionId, options), { json: !!opts.json });
    }));
}
