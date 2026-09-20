import { Command, Option } from "commander";
import type { RuleDirection } from "@inkbox/sdk";

export function addDirectionalRuleOptions(parent: Command): void {
  for (const command of parent.commands) {
    if (!["create", "update", "list", "list-all"].includes(command.name())) continue;
    command.addOption(new Option("--direction <direction>", "Rule coverage; inbound/outbound lists include both").choices(["inbound", "outbound", "both"]));
    if (command.name() === "update") {
      command.description("Update rule action or directional coverage (admin-only)");
      command.options.find((option) => option.long === "--action")?.makeOptionMandatory(false);
      command.addOption(new Option("--apply-to <direction>", "Change action on one covered side, preserving the other").choices(["inbound", "outbound"]));
    }
  }
}

export function directionalRuleOptions(command: Command): { direction?: RuleDirection; applyTo?: "inbound" | "outbound" } {
  const { direction, applyTo, action } = command.opts();
  if (command.name() === "update") {
    if (action === undefined && direction === undefined) throw new Error("--action or --direction is required");
    if (applyTo !== undefined && (action === undefined || direction !== undefined)) {
      throw new Error("--apply-to requires --action and cannot be combined with --direction");
    }
  }
  return { ...(direction !== undefined ? { direction } : {}), ...(applyTo !== undefined ? { applyTo } : {}) };
}
