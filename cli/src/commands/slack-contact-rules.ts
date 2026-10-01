/** Identity-owned Slack policy; agent keys can read, never grant themselves permission. */
import { Command, InvalidArgumentError, Option } from "commander";
import type { CreateSlackContactRuleOptions, ListSlackContactRulesOptions, SlackContactRuleSettings, UpdateSlackContactRuleOptions } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { addDirectionalRuleOptions, directionalRuleOptions } from "../contact-rules.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

function integer(value: string, minimum: number, maximum: number): number {
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new InvalidArgumentError(`Expected an integer between ${minimum} and ${maximum}`);
  }
  return result;
}
const owner = (command: Command): Command => command.requiredOption("--identity <handle>", "Owning agent handle");
const action = () => new Option("--action <action>", "Allow or block").choices(["allow", "block"]);
const target = () => new Option("--match-type <type>", "Verified person or home workspace").choices(["exact_user", "workspace"]);
function result(command: Command, value: unknown): void {
  output(value as Record<string, unknown>, { json: !!getGlobalOpts(command).json });
}

export function registerSlackContactRuleCommands(slack: Command): void {
  const rules = slack.command("contact-rule").description("Slack directional rules (writes: human JWT or organization-management key)");
  owner(rules.command("list").description("List one page of identity rules"))
    .addOption(action()).addOption(target())
    .option("--limit <n>", "Page size 1-200", v => integer(v, 1, 200))
    .option("--offset <n>", "Offset 0-10000", v => integer(v, 0, 10000))
    .action(withErrorHandler(async function(this: Command, o: ListSlackContactRulesOptions & { identity: string }) {
      result(this, await createClient(getGlobalOpts(this)).slack.contactRules.list(o.identity, {
        action: o.action, matchType: o.matchType, limit: o.limit, offset: o.offset, ...directionalRuleOptions(this),
      }));
    }));
  owner(rules.command("get <rule-id>").description("Read a rule"))
    .action(withErrorHandler(async function(this: Command, id: string, o: { identity: string }) {
      result(this, await createClient(getGlobalOpts(this)).slack.contactRules.get(o.identity, id));
    }));
  owner(rules.command("create").description("Create or extend directional coverage"))
    .addOption(action().makeOptionMandatory()).addOption(target().makeOptionMandatory())
    .requiredOption("--match-target <target>", "Home workspace:user (T123:U456), or workspace ID (T123)")
    .action(withErrorHandler(async function(this: Command, o: CreateSlackContactRuleOptions & { identity: string }) {
      result(this, await createClient(getGlobalOpts(this)).slack.contactRules.create(o.identity, {
        action: o.action, matchType: o.matchType, matchTarget: o.matchTarget, ...directionalRuleOptions(this),
      }));
    }));
  owner(rules.command("update <rule-id>")).addOption(action())
    .action(withErrorHandler(async function(this: Command, id: string, o: UpdateSlackContactRuleOptions & { identity: string }) {
      result(this, await createClient(getGlobalOpts(this)).slack.contactRules.update(o.identity, id, {
        action: o.action, ...directionalRuleOptions(this),
      }));
    }));
  owner(rules.command("delete <rule-id>").description("Delete a rule, preserving contacts and messages"))
    .action(withErrorHandler(async function(this: Command, id: string, o: { identity: string }) {
      await createClient(getGlobalOpts(this)).slack.contactRules.delete(o.identity, id);
      result(this, { deleted: true });
    }));
  const settings = rules.command("settings").description("Independent inbound/outbound defaults");
  owner(settings.command("get"))
    .action(withErrorHandler(async function(this: Command, o: { identity: string }) {
      result(this, await createClient(getGlobalOpts(this)).slack.contactRules.getSettings(o.identity));
    }));
  owner(settings.command("update"))
    .addOption(new Option("--inbound-filter-mode <mode>", "Incoming default").choices(["blacklist", "whitelist"]))
    .addOption(new Option("--outbound-filter-mode <mode>", "Outgoing default").choices(["blacklist", "whitelist"]))
    .action(withErrorHandler(async function(this: Command, o: Partial<SlackContactRuleSettings> & { identity: string }) {
      result(this, await createClient(getGlobalOpts(this)).slack.contactRules.updateSettings(o.identity, {
        inboundFilterMode: o.inboundFilterMode, outboundFilterMode: o.outboundFilterMode,
      }));
    }));
  addDirectionalRuleOptions(rules);
  rules.commands.find(c => c.name() === "update")!.description("Change coverage or one side's action (human JWT or organization-management key)");
}
