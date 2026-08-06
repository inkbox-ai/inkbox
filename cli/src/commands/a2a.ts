import { readFile } from "node:fs/promises";
import { Command, Option } from "commander";
import type {
  A2AContext,
  A2AHistoryDirection,
  A2AHistoryMessage,
  A2AMessageRole,
  A2AReplyIntent,
  A2ARuleAction,
  A2ARuleDirection,
  A2ASkill,
  A2ATaskState,
  FilterMode,
  A2AInvitationStatus,
} from "@inkbox/sdk";
import {
  AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_CLAIMED,
  extractA2AInvitationToken,
} from "@inkbox/sdk";
import { createClient, getGlobalOpts, resolveBaseUrl } from "../client.js";
import { withErrorHandler } from "../errors.js";
import { output } from "../output.js";
import { redactSecretError, resolveA2AInvitationToken } from "../invitation-token.js";

const TASK_COLUMNS = [
  "id",
  "requesterHandle",
  "workerHandle",
  "contextId",
  "state",
  "createdAt",
  "updatedAt",
];
const SENT_TASK_COLUMNS = [
  "id",
  "requesterHandle",
  "workerHandle",
  "contextId",
  "state",
  "createdAt",
  "updatedAt",
];
const MESSAGE_COLUMNS = [
  "id",
  "taskId",
  "contextId",
  "taskState",
  "role",
  "requesterHandle",
  "workerHandle",
  "text",
  "createdAt",
];
const CONTEXT_COLUMNS = [
  "id",
  "name",
  "peerHandle",
  "originalDirection",
  "taskCount",
  "lastActivityAt",
];
const RULE_COLUMNS = ["id", "action", "matchTarget", "direction", "status"];
const DIRECTORY_COLUMNS = ["name", "cardUrl", "visibility", "description"];
const INVITATION_COLUMNS = [
  "id",
  "status",
  "recipientEmail",
  "peerAgentHandles",
  "inviteeAgentHandle",
  "expiresAt",
];

async function identityFor(command: Command, handle: string) {
  return createClient(getGlobalOpts(command)).getIdentity(handle);
}

function positiveInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return parsed;
}

function outputCursorPage(
  page: { items: unknown[]; nextCursor: string | null },
  command: Command,
  columns: string[],
  tableItems: Record<string, unknown>[],
): void {
  const json = !!getGlobalOpts(command).json;
  if (json) {
    output(page, { json: true });
    return;
  }
  output(tableItems, { json: false, columns });
  if (page.nextCursor) {
    console.error(`Next cursor: ${page.nextCursor}`);
  }
}

function messageText(message: A2AHistoryMessage): string {
  return message.parts
    .map((part) => ("text" in part ? String(part.text) : ""))
    .filter(Boolean)
    .join(" ");
}

function contextTableItem(
  context: A2AContext,
  identityId: string,
): Record<string, unknown> {
  const openedByIdentity = context.caller.identityId === identityId;
  return {
    ...context,
    peerHandle: openedByIdentity
      ? context.target?.handle ?? null
      : context.caller.handle,
    originalDirection: openedByIdentity ? "outbound" : "inbound",
    taskCount: context.tasksTruncated
      ? `${context.tasks.length}+`
      : context.tasks.length,
  };
}

export function registerA2ACommands(program: Command): void {
  const a2a = program.command("a2a").description("Work with A2A agents and tasks");

  const invites = a2a.command("invites").description("Manage A2A connection invitations");

  invites.command("create")
    .description("Create an A2A invitation (organization admin)")
    .requiredOption("--peer-agent-handle <handle...>", "Agent handles to connect")
    .option("--recipient-email <email>", "Bind and email the invitation to this recipient")
    .option("--expires-in-seconds <seconds>", "Invitation lifetime", (value) => positiveInt(value, "expires-in-seconds"))
    .action(withErrorHandler(async function (
      this: Command,
      options: { peerAgentHandle: string[]; recipientEmail?: string; expiresInSeconds?: number },
    ) {
      const result = await createClient(getGlobalOpts(this)).a2aInvitations.create({
        peerAgentHandles: options.peerAgentHandle,
        recipientEmail: options.recipientEmail,
        expiresInSeconds: options.expiresInSeconds,
      });
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  invites.command("list")
    .description("List invitations issued by the organization")
    .option("--status <status>", "Filter by invitation status")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--limit <n>", "Maximum results", (value) => positiveInt(value, "limit"), 50)
    .action(withErrorHandler(async function (
      this: Command,
      options: { status?: A2AInvitationStatus; cursor?: string; limit: number },
    ) {
      const page = await createClient(getGlobalOpts(this)).a2aInvitations.list(options);
      outputCursorPage(
        page,
        this,
        INVITATION_COLUMNS,
        page.items.map((item) => ({ ...item })),
      );
    }));

  invites.command("show <invitation-id>")
    .description("Show an invitation")
    .action(withErrorHandler(async function (this: Command, invitationId: string) {
      const result = await createClient(getGlobalOpts(this)).a2aInvitations.get(invitationId);
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  invites.command("revoke <invitation-id>")
    .description("Revoke a pending invitation")
    .action(withErrorHandler(async function (this: Command, invitationId: string) {
      const result = await createClient(getGlobalOpts(this)).a2aInvitations.revoke(invitationId);
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  invites.command("accept")
    .description("Accept an invitation with a claimed agent-scoped API key")
    .option("--invitation-stdin", "Read the invitation link or token from stdin")
    .option("--token-stdin", "Read the invitation token from stdin")
    .action(withErrorHandler(async function (
      this: Command,
      options: { invitationStdin?: boolean; tokenStdin?: boolean },
    ) {
      if (options.invitationStdin && options.tokenStdin) {
        throw new Error("Use only one invitation stdin option.");
      }
      const globalOpts = getGlobalOpts(this);
      const client = createClient(getGlobalOpts(this));
      const principal = await client.whoami();
      if (
        principal.authType !== "api_key"
        || principal.authSubtype !== AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_CLAIMED
      ) {
        throw new Error("Accepting an invitation requires a claimed agent-scoped API key.");
      }
      const invitation = await resolveA2AInvitationToken(
        !!options.invitationStdin || !!options.tokenStdin,
      );
      let token: string | undefined;
      try {
        const parsedToken = extractA2AInvitationToken(
          invitation,
          resolveBaseUrl(globalOpts) ?? "https://inkbox.ai",
        );
        token = parsedToken;
        const result = await client.a2aInvitations.accept(parsedToken);
        output(result, { json: !!globalOpts.json });
      } catch (error) {
        throw redactSecretError(error, invitation, token ?? "");
      }
    }));

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

  a2a.command("settings")
    .description("Show an identity's A2A settings")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      options: { identity: string },
    ) {
      const result = await (await identityFor(this, options.identity)).a2aSettings();
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("publicly-discoverable <state>")
    .description("Set public directory visibility (admin API key required)")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      state: string,
      options: { identity: string },
    ) {
      if (!["true", "false"].includes(state)) {
        throw new TypeError("state must be 'true' or 'false'");
      }
      const result = await (
        await identityFor(this, options.identity)
      ).a2aSetPubliclyDiscoverable(state === "true");
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("public-egress <state>")
    .description("Allow or deny calls to publicly discoverable agents")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      state: string,
      options: { identity: string },
    ) {
      if (!["true", "false"].includes(state)) {
        throw new TypeError("state must be 'true' or 'false'");
      }
      const result = await (
        await identityFor(this, options.identity)
      ).a2aSetAllowPublicEgress(state === "true");
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("directory")
    .description("Search the organization or public A2A directory")
    .option("--public", "Search the public directory")
    .option("-q, --query <query>", "Search handles, descriptions, and skills")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--limit <n>", "Results per page (1-100)", "50")
    .action(withErrorHandler(async function (
      this: Command,
      options: {
        public?: boolean;
        query?: string;
        cursor?: string;
        limit: string;
      },
    ) {
      const client = createClient(getGlobalOpts(this));
      const result = options.public
        ? await client.a2a.publicDirectory({
          q: options.query,
          cursor: options.cursor,
          limit: positiveInt(options.limit, "--limit"),
        })
        : await client.a2a.organizationDirectory({
          q: options.query,
          cursor: options.cursor,
          limit: positiveInt(options.limit, "--limit"),
        });
      outputCursorPage(
        result,
        this,
        DIRECTORY_COLUMNS,
        result.items.map((item) => ({
          ...item,
          name: item.card.name,
          description: item.card.description ?? "",
        })),
      );
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

  skills.command("reset")
    .description("Restore the receiver's default advertised skills")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      options: { identity: string },
    ) {
      const result = await (await identityFor(this, options.identity)).a2aResetSkills();
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("filter-mode")
    .description("Set A2A admission mode (admin API key required)")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("--mode <mode>", "'whitelist' or 'blacklist'")
    .action(withErrorHandler(async function (
      this: Command,
      options: { identity: string; mode: string },
    ) {
      if (!["whitelist", "blacklist"].includes(options.mode)) {
        throw new TypeError("--mode must be 'whitelist' or 'blacklist'");
      }
      const result = await (await identityFor(this, options.identity)).a2aSetFilterMode(
        options.mode as FilterMode,
      );
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  const rules = a2a.command("rules").description("Manage directional A2A contact rules");
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
    .option("--direction <direction>", "'inbound', 'outbound', or 'both'", "inbound")
    .action(withErrorHandler(async function (
      this: Command,
      options: {
        identity: string;
        handle: string;
        action: string;
        direction: string;
      },
    ) {
      if (!["allow", "block"].includes(options.action)) {
        throw new TypeError("--action must be 'allow' or 'block'");
      }
      if (!["inbound", "outbound", "both"].includes(options.direction)) {
        throw new TypeError(
          "--direction must be 'inbound', 'outbound', or 'both'",
        );
      }
      const result = await (await identityFor(this, options.identity)).a2aAddContactRule({
        handle: options.handle,
        action: options.action as A2ARuleAction,
        direction: options.direction as A2ARuleDirection,
      });
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  rules.command("update <rule-id>")
    .description("Update an A2A contact rule (admin API key required)")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--action <action>", "'allow' or 'block'")
    .option("--direction <direction>", "'inbound', 'outbound', or 'both'")
    .action(withErrorHandler(async function (
      this: Command,
      ruleId: string,
      options: {
        identity: string;
        action?: string;
        direction?: string;
      },
    ) {
      if (options.action !== undefined && !["allow", "block"].includes(options.action)) {
        throw new TypeError("--action must be 'allow' or 'block'");
      }
      if (
        options.direction !== undefined
        && !["inbound", "outbound", "both"].includes(options.direction)
      ) {
        throw new TypeError(
          "--direction must be 'inbound', 'outbound', or 'both'",
        );
      }
      if (options.action === undefined && options.direction === undefined) {
        throw new TypeError("Pass at least one of --action or --direction");
      }
      const result = await (
        await identityFor(this, options.identity)
      ).a2aUpdateContactRule(ruleId, {
        action: options.action as A2ARuleAction | undefined,
        direction: options.direction as A2ARuleDirection | undefined,
      });
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  rules.command("delete <rule-id>")
    .description("Delete an A2A contact rule (admin API key required)")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      ruleId: string,
      options: { identity: string },
    ) {
      await (await identityFor(this, options.identity)).a2aDeleteContactRule(ruleId);
      output({ deleted: true, id: ruleId }, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("tasks")
    .description("List an identity's A2A task history")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--direction <direction>", "Filter: inbound, outbound, or both")
    .option("--requester <handle>", "Filter by requester identity")
    .option("--worker <handle>", "Filter by worker identity")
    .option("--state <state>", "Filter by task state")
    .option("--context <id>", "Filter by context ID")
    .option("-q, --query <query>", "Search task message content")
    .option("--since <datetime>", "Only tasks created at or after this time")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--limit <n>", "Results per page (1-100)", "50")
    .action(withErrorHandler(async function (
      this: Command,
      options: {
        identity: string;
        direction?: string;
        requester?: string;
        worker?: string;
        state?: string;
        context?: string;
        query?: string;
        since?: string;
        cursor?: string;
        limit: string;
      },
    ) {
      const result = await (await identityFor(this, options.identity)).a2aTasks({
        direction: options.direction as A2AHistoryDirection | undefined,
        requesterHandle: options.requester,
        workerHandle: options.worker,
        state: options.state as A2ATaskState | undefined,
        contextId: options.context,
        q: options.query,
        since: options.since,
        cursor: options.cursor,
        limit: positiveInt(options.limit, "--limit"),
      });
      const items = result.items.map((task) => ({
        ...task,
        requesterHandle: task.caller.handle,
        workerHandle: task.target?.handle ?? null,
      }));
      outputCursorPage(
        result,
        this,
        TASK_COLUMNS,
        items,
      );
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

  a2a.command("sent")
    .description("List A2A tasks sent by an identity")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--requester <handle>", "Filter by requester identity")
    .option("--worker <handle>", "Filter by worker identity")
    .option("--state <state>", "Filter by task state")
    .option("--context <id>", "Filter by context ID")
    .option("-q, --query <query>", "Search task message content")
    .option("--since <datetime>", "Only tasks created at or after this time")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--limit <n>", "Results per page (1-100)", "50")
    .action(withErrorHandler(async function (
      this: Command,
      options: {
        identity: string;
        requester?: string;
        worker?: string;
        state?: string;
        context?: string;
        query?: string;
        since?: string;
        cursor?: string;
        limit: string;
      },
    ) {
      const result = await (await identityFor(this, options.identity)).a2aSentTasks({
        requesterHandle: options.requester,
        workerHandle: options.worker,
        state: options.state as A2ATaskState | undefined,
        contextId: options.context,
        q: options.query,
        since: options.since,
        cursor: options.cursor,
        limit: positiveInt(options.limit, "--limit"),
      });
      const items = result.items.map((task) => ({
        ...task,
        requesterHandle: task.caller.handle,
        workerHandle: task.target?.handle ?? null,
      }));
      outputCursorPage(result, this, SENT_TASK_COLUMNS, items);
    }));

  a2a.command("sent-task <task-id>")
    .description("Show a full A2A task sent by an identity")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      taskId: string,
      options: { identity: string },
    ) {
      const result = await (await identityFor(this, options.identity)).a2aSentTask(taskId);
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("contexts")
    .description("List an identity's A2A contexts")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--direction <direction>", "Filter: inbound, outbound, or both")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--limit <n>", "Results per page (1-100)", "50")
    .action(withErrorHandler(async function (
      this: Command,
      options: {
        identity: string;
        direction?: string;
        cursor?: string;
        limit: string;
      },
    ) {
      const identity = await identityFor(this, options.identity);
      const result = await identity.a2aContexts({
        direction: options.direction as
          | "inbound"
          | "outbound"
          | "both"
          | undefined,
        cursor: options.cursor,
        limit: positiveInt(options.limit, "--limit"),
      });
      outputCursorPage(
        result,
        this,
        CONTEXT_COLUMNS,
        result.items.map((context) => contextTableItem(context, identity.id)),
      );
    }));

  a2a.command("context <context-id>")
    .description("Show a context originally received by an identity")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      contextId: string,
      options: { identity: string },
    ) {
      const result = await (
        await identityFor(this, options.identity)
      ).a2aContext(contextId);
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("sent-contexts")
    .description("List contexts originally opened by an identity")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--limit <n>", "Results per page (1-100)", "50")
    .action(withErrorHandler(async function (
      this: Command,
      options: { identity: string; cursor?: string; limit: string },
    ) {
      const identity = await identityFor(this, options.identity);
      const result = await identity.a2aSentContexts({
        cursor: options.cursor,
        limit: positiveInt(options.limit, "--limit"),
      });
      outputCursorPage(
        result,
        this,
        CONTEXT_COLUMNS,
        result.items.map((context) => contextTableItem(context, identity.id)),
      );
    }));

  a2a.command("sent-context <context-id>")
    .description("Show a context originally opened by an identity")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      contextId: string,
      options: { identity: string },
    ) {
      const result = await (
        await identityFor(this, options.identity)
      ).a2aSentContext(contextId);
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("rename-context <context-id>")
    .description("Rename an A2A context shared with an identity")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("--name <name>", "New context name (up to five words)")
    .action(withErrorHandler(async function (
      this: Command,
      contextId: string,
      options: { identity: string; name: string },
    ) {
      const result = await (
        await identityFor(this, options.identity)
      ).a2aUpdateContext(contextId, { name: options.name });
      output(result, { json: !!getGlobalOpts(this).json });
    }));

  a2a.command("messages")
    .description("List and search an identity's A2A message history")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--direction <direction>", "Filter: inbound, outbound, or both")
    .option("--requester <handle>", "Filter by requester identity")
    .option("--worker <handle>", "Filter by worker identity")
    .option("--task <id>", "Filter by task ID")
    .option("--context <id>", "Filter by context ID")
    .option("--role <role>", "Filter: caller or agent")
    .option("-q, --query <query>", "Search message content")
    .option("--since <datetime>", "Only messages created at or after this time")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--limit <n>", "Results per page (1-100)", "50")
    .action(withErrorHandler(async function (
      this: Command,
      options: {
        identity: string;
        direction?: string;
        requester?: string;
        worker?: string;
        task?: string;
        context?: string;
        role?: string;
        query?: string;
        since?: string;
        cursor?: string;
        limit: string;
      },
    ) {
      const result = await (await identityFor(this, options.identity)).a2aMessages({
        direction: options.direction as A2AHistoryDirection | undefined,
        requesterHandle: options.requester,
        workerHandle: options.worker,
        taskId: options.task,
        contextId: options.context,
        role: options.role as A2AMessageRole | undefined,
        q: options.query,
        since: options.since,
        cursor: options.cursor,
        limit: positiveInt(options.limit, "--limit"),
      });
      const items = result.items.map((message) => ({
        ...message,
        requesterHandle: message.caller.handle,
        workerHandle: message.target?.handle ?? null,
        text: messageText(message),
      }));
      outputCursorPage(result, this, MESSAGE_COLUMNS, items);
    }));

  a2a.command("reply <task-id>")
    .description("Reply to an inbound A2A task")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("--text <text>", "Reply text")
    .addOption(new Option("--progress", "Post progress and keep working").conflicts(["complete", "ask", "fail"]))
    .addOption(new Option("--complete", "Complete the task").conflicts(["progress", "ask", "fail"]))
    .addOption(new Option("--ask", "Ask the caller for input").conflicts(["progress", "complete", "fail"]))
    .addOption(new Option("--fail", "Fail the task").conflicts(["progress", "complete", "ask"]))
    .action(withErrorHandler(async function (
      this: Command,
      taskId: string,
      options: {
        identity: string;
        text: string;
        progress?: boolean;
        complete?: boolean;
        ask?: boolean;
        fail?: boolean;
      },
    ) {
      const selected = [
        options.progress,
        options.complete,
        options.ask,
        options.fail,
      ].filter(Boolean);
      if (selected.length !== 1) {
        throw new TypeError(
          "Pass exactly one of --progress, --complete, --ask, or --fail",
        );
      }
      const intent: A2AReplyIntent = options.progress
        ? "progress"
        : options.complete
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
    .option(
      "--context <id>",
      "Start a new task in an existing context when --task is absent",
    )
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
