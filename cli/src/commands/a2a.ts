import { readFile } from "node:fs/promises";
import { Command, Option } from "commander";
import type {
  A2AReplyIntent,
  A2ARuleAction,
  A2ASkill,
  A2ATaskState,
} from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { withErrorHandler } from "../errors.js";
import { output } from "../output.js";

const TASK_COLUMNS = ["id", "contextId", "state", "createdAt", "updatedAt"];
const RULE_COLUMNS = ["id", "action", "matchTarget", "direction", "status"];

async function identityFor(command: Command, handle: string) {
  return createClient(getGlobalOpts(command)).getIdentity(handle);
}

export function registerA2ACommands(program: Command): void {
  const a2a = program.command("a2a").description("Work with A2A agents and tasks");

  a2a.command("enable")
    .description("Enable an identity's A2A receiver")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      options: { identity: string },
    ) {
      const result = await (await identityFor(this, options.identity)).a2aEnable();
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("disable")
    .description("Disable an identity's A2A receiver")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      options: { identity: string },
    ) {
      const result = await (await identityFor(this, options.identity)).a2aDisable();
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("card")
    .description("Show an identity's Agent Card")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      options: { identity: string },
    ) {
      const result = await (await identityFor(this, options.identity)).a2aCard();
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  const skills = a2a.command("skills").description("Manage Agent Card skills");
  skills.command("set")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("--file <path>", "JSON file containing an array of skills")
    .action(withErrorHandler(async function (
      this: Command,
      options: { identity: string; file: string },
    ) {
      const parsed = JSON.parse(await readFile(options.file, "utf8")) as A2ASkill[];
      if (!Array.isArray(parsed)) throw new TypeError("Skills file must contain a JSON array");
      const result = await (await identityFor(this, options.identity)).a2aSetSkills(parsed);
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  const rules = a2a.command("rules").description("Manage inbound A2A contact rules");
  rules.command("list")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      options: { identity: string },
    ) {
      const result = await (await identityFor(this, options.identity)).a2aContactRules();
      output(result, { json: !!getGlobalOpts(this).json, columns: RULE_COLUMNS });
    }));

  rules.command("add")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("--handle <peer>", "Caller handle to match")
    .requiredOption("--action <action>", "'allow' or 'block'")
    .action(withErrorHandler(async function (
      this: Command,
      options: { identity: string; handle: string; action: string },
    ) {
      if (!["allow", "block"].includes(options.action)) {
        throw new TypeError("--action must be 'allow' or 'block'");
      }
      const result = await (await identityFor(this, options.identity)).a2aAddContactRule({
        handle: options.handle,
        action: options.action as A2ARuleAction,
      });
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("tasks")
    .description("List an identity's inbound A2A tasks")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--state <state>", "Filter by task state")
    .action(withErrorHandler(async function (
      this: Command,
      options: { identity: string; state?: string },
    ) {
      const result = await (await identityFor(this, options.identity)).a2aTasks({
        state: options.state as A2ATaskState | undefined,
      });
      output(result.items, { json: !!getGlobalOpts(this).json, columns: TASK_COLUMNS });
    }));

  a2a.command("task <task-id>")
    .description("Show a full inbound A2A task")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      taskId: string,
      options: { identity: string },
    ) {
      const result = await (await identityFor(this, options.identity)).a2aTask(taskId);
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("reply <task-id>")
    .description("Reply to an inbound A2A task")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("--text <text>", "Reply text")
    .addOption(new Option("--complete", "Complete the task").conflicts(["ask", "fail"]))
    .addOption(new Option("--ask", "Ask the caller for input").conflicts(["complete", "fail"]))
    .addOption(new Option("--fail", "Fail the task").conflicts(["complete", "ask"]))
    .action(withErrorHandler(async function (
      this: Command,
      taskId: string,
      options: {
        identity: string;
        text: string;
        complete?: boolean;
        ask?: boolean;
        fail?: boolean;
      },
    ) {
      const selected = [options.complete, options.ask, options.fail].filter(Boolean);
      if (selected.length !== 1) throw new TypeError("Pass exactly one of --complete, --ask, or --fail");
      const intent: A2AReplyIntent = options.complete
        ? "complete"
        : options.ask ? "ask_caller" : "fail";
      const result = await (await identityFor(this, options.identity)).a2aReply(taskId, {
        intent,
        text: options.text,
      });
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("call <card-url>")
    .description("Send a task to an A2A agent")
    .requiredOption("-i, --identity <handle>", "Local identity handle")
    .requiredOption("--text <text>", "Task text")
    .option("--context <id>", "Continue a context")
    .option("--task <id>", "Continue a task")
    .option("--message-id <id>", "Stable idempotency ID")
    .action(withErrorHandler(async function (
      this: Command,
      cardUrl: string,
      options: {
        identity: string;
        text: string;
        context?: string;
        task?: string;
        messageId?: string;
      },
    ) {
      const identity = await identityFor(this, options.identity);
      const client = await identity.a2aClient();
      const target = await client.fetchCard(cardUrl);
      const result = await client.send(target, {
        text: options.text,
        contextId: options.context,
        taskId: options.task,
        messageId: options.messageId,
      });
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("check <card-url> <task-id>")
    .description("Fetch or wait for a remote A2A task")
    .requiredOption("-i, --identity <handle>", "Local identity handle")
    .option("--wait", "Poll until the task stops")
    .action(withErrorHandler(async function (
      this: Command,
      cardUrl: string,
      taskId: string,
      options: { identity: string; wait?: boolean },
    ) {
      const identity = await identityFor(this, options.identity);
      const client = await identity.a2aClient();
      const target = await client.fetchCard(cardUrl);
      const result = options.wait
        ? await client.wait(target, taskId)
        : await client.getTask(target, taskId);
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("cancel <card-url> <task-id>")
    .description("Cancel a remote A2A task")
    .requiredOption("-i, --identity <handle>", "Local identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      cardUrl: string,
      taskId: string,
      options: { identity: string },
    ) {
      const identity = await identityFor(this, options.identity);
      const client = await identity.a2aClient();
      const target = await client.fetchCard(cardUrl);
      output(await client.cancel(target, taskId), { json: !!getGlobalOpts(this).json });
    }));
}
