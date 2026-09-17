import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import type { SlackProcessingStatus, SlackResource } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import { slackInteger } from "./slack.js";

interface Args {
  connectionId: string;
  conversationId: string;
  messageTs: string;
  idempotencyKey: string;
  identityId: string;
  workspaceId?: string;
  userId: string;
  operationId: string;
  name: string;
  text: string;
  status: SlackProcessingStatus;
  threadTs: string;
  file: string;
  filename?: string;
  title?: string;
  initialComment?: string;
  limit?: number;
  cursor?: string;
  captureEnabled: boolean;
  retentionDays?: number | "null";
  captureConversationId?: string[];
  beforeTs?: string;
  afterTs?: string;
  q: string;
  restart?: boolean;
}
const connection = (c: Command): Command =>
  c.requiredOption("--connection-id <id>", "Slack workspace connection UUID");
const conversation = (c: Command): Command =>
  connection(c).requiredOption(
    "--conversation-id <id>",
    "Slack conversation ID",
  );
const message = (c: Command): Command =>
  conversation(c).requiredOption(
    "--message-ts <timestamp>",
    "Exact Slack timestamp (string)",
  );
const key = (c: Command): Command =>
  c.requiredOption(
    "--idempotency-key <key>",
    "Stable key for this exact operation; never blindly repeat unknown outcomes",
  );
const page = (c: Command): Command =>
  c
    .option("--limit <n>", "One page size", slackInteger)
    .option("--cursor <cursor>", "Next-page cursor; no automatic pagination");
function action(
  c: Command,
  call: (slack: SlackResource, o: Args) => Promise<unknown>,
): void {
  c.action(
    withErrorHandler(async function (this: Command, o: Args) {
      const opts = getGlobalOpts(this);
      output(await call(createClient(opts).slack, o), { json: !!opts.json });
    }),
  );
}
function boolean(value: string): boolean {
  if (value !== "true" && value !== "false")
    throw new InvalidArgumentError("Expected true or false");
  return value === "true";
}
async function fileContent(path: string): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  const stream = createReadStream(path);
  try {
    for await (const part of stream) {
      const chunk = Buffer.from(part);
      size += chunk.length;
      if (size > 10 * 1024 * 1024)
        throw new InvalidArgumentError("File exceeds 10 MiB");
      chunks.push(chunk);
    }
  } finally {
    stream.destroy();
  }
  if (size === 0) throw new InvalidArgumentError("File is empty");
  return Buffer.concat(chunks).toString("base64");
}
export function registerSlackOperationCommands(
  slack: Command,
  groups: { conversations: Command; messages: Command; files: Command },
): void {
  const { conversations, messages, files } = groups;
  action(
    connection(
      slack
        .command("capabilities")
        .description(
          "Inspect granted and missing scopes; native status support remains workspace-dependent",
        ),
    ),
    (s, o) => s.capabilities(o.connectionId),
  );
  const installations = slack
    .command("installation")
    .description("Organization management: browser installation handoff");
  action(
    installations
      .command("start")
      .requiredOption("--identity-id <id>", "Owning identity UUID")
      .option("--workspace-id <id>", "Expected Slack workspace ID")
      .description(
        "Return a short-lived secret URL to open in a browser; do not log or share it",
      ),
    (s, o) => s.startInstallation(o.identityId, { workspaceId: o.workspaceId }),
  );
  const users = slack
    .command("user")
    .description("Read Slack people accessible to this connection");
  action(page(connection(users.command("list"))), (s, o) =>
    s.listUsers(o.connectionId, o),
  );
  action(
    connection(users.command("get")).requiredOption(
      "--user-id <id>",
      "Slack user ID",
    ),
    (s, o) => s.getUser(o.connectionId, o.userId),
  );
  action(page(conversation(conversations.command("members"))), (s, o) =>
    s.listMembers(o.connectionId, o.conversationId, o),
  );
  action(key(conversation(conversations.command("join"))), (s, o) =>
    s.joinConversation(o.connectionId, o.conversationId, o),
  );
  action(key(conversation(conversations.command("leave"))), (s, o) =>
    s.leaveConversation(o.connectionId, o.conversationId, o),
  );
  action(
    message(messages.command("get")).option(
      "--thread-ts <timestamp>",
      "Root timestamp when reading a reply",
    ),
    (s, o) => s.getMessage(o.connectionId, o.conversationId, o.messageTs, o),
  );
  action(
    message(messages.command("context"))
      .description("Bounded live window, not complete retained history")
      .option("--limit <n>", "Window size 1..15", slackInteger)
      .option("--thread-ts <timestamp>", "Optional root timestamp"),
    (s, o) =>
      s.messageContext(o.connectionId, o.conversationId, o.messageTs, o),
  );
  action(message(messages.command("permalink")), (s, o) =>
    s.getPermalink(o.connectionId, o.conversationId, o.messageTs),
  );
  action(
    key(
      message(
        messages
          .command("update")
          .description("Edit the connected agent's own message"),
      ),
    ).requiredOption("--text <text>", "Replacement message text"),
    (s, o) =>
      s.updateMessage(o.connectionId, o.conversationId, o.messageTs, o.text, o),
  );
  action(
    key(
      message(
        messages
          .command("delete")
          .description("Delete the connected agent's own message"),
      ),
    ),
    (s, o) => s.deleteMessage(o.connectionId, o.conversationId, o.messageTs, o),
  );
  const reactions = slack.command("reaction");
  action(message(reactions.command("get")), (s, o) =>
    s.getReactions(o.connectionId, o.conversationId, o.messageTs),
  );
  action(
    key(message(reactions.command("add"))).requiredOption(
      "--name <name>",
      "Reaction name without surrounding colons",
    ),
    (s, o) =>
      s.addReaction(o.connectionId, o.conversationId, o.messageTs, o.name, o),
  );
  action(
    key(message(reactions.command("remove"))).requiredOption(
      "--name <name>",
      "Reaction name without surrounding colons",
    ),
    (s, o) =>
      s.removeReaction(
        o.connectionId,
        o.conversationId,
        o.messageTs,
        o.name,
        o,
      ),
  );
  const pins = slack.command("pin");
  action(conversation(pins.command("list")), (s, o) =>
    s.listPins(o.connectionId, o.conversationId),
  );
  action(key(message(pins.command("add"))), (s, o) =>
    s.addPin(o.connectionId, o.conversationId, o.messageTs, o),
  );
  action(key(message(pins.command("remove"))), (s, o) =>
    s.removePin(o.connectionId, o.conversationId, o.messageTs, o),
  );
  const operations = slack
    .command("operation")
    .description("Inspect durable actions; unknown is terminal uncertainty");
  action(
    connection(operations.command("get")).requiredOption(
      "--operation-id <id>",
      "Operation UUID",
    ),
    (s, o) => s.getOperation(o.connectionId, o.operationId),
  );
  const processing = slack.command("processing-status");
  action(
    key(conversation(processing.command("set")))
      .requiredOption("--thread-ts <timestamp>", "Thread timestamp")
      .requiredOption(
        "--status <status>",
        "active, processing, suspended, or closed",
      ),
    (s, o) =>
      s.setProcessingStatus(
        o.connectionId,
        o.conversationId,
        o.threadTs,
        o.status,
        o,
      ),
  );
  action(
    key(conversation(files.command("upload")))
      .description("Upload general file bytes, bounded to 1 byte..10 MiB")
      .requiredOption("--file <path>", "Local file to upload")
      .option("--filename <name>", "Override basename")
      .option("--title <title>", "File title")
      .option("--initial-comment <text>", "Accompanying message")
      .option("--thread-ts <timestamp>", "Reply thread"),
    async (s, o) =>
      s.uploadFile(o.connectionId, {
        ...o,
        filename: o.filename ?? basename(o.file),
        contentBase64: await fileContent(o.file),
      }),
  );
  const archive = slack
    .command("archive")
    .description(
      "Retained history; default-on observed-message capture, bounded imports, and coverage",
    );
  const settings = archive.command("settings");
  action(connection(settings.command("get")), (s, o) =>
    s.getArchiveSettings(o.connectionId),
  );
  action(
    connection(
      settings
        .command("update")
        .description("Organization management: replace capture settings"),
    )
      .requiredOption("--capture-enabled <boolean>", "true or false", boolean)
      .option(
        "--retention-days <days|null>",
        "Retention limit or null for no time limit",
        (v) => (v === "null" ? "null" : slackInteger(v)),
      )
      .option(
        "--capture-conversation-id <id>",
        "Capture only these conversations (repeatable); default all",
        (v: string, previous: string[]) => [...previous, v],
        [] as string[],
      ),
    (s, o) =>
      s.updateArchiveSettings(o.connectionId, {
        captureEnabled: o.captureEnabled,
        retentionDays: o.retentionDays === "null" ? null : o.retentionDays,
        conversationIds: o.captureConversationId,
      }),
  );
  const filters = (c: Command): Command =>
    page(connection(c))
      .option("--conversation-id <id>", "Conversation filter")
      .option("--before-ts <timestamp>", "Exclusive upper timestamp")
      .option("--after-ts <timestamp>", "Exclusive lower timestamp");
  action(
    filters(archive.command("messages")).option(
      "--thread-ts <timestamp>",
      "Thread filter (requires conversation)",
    ),
    (s, o) => s.listArchivedMessages(o.connectionId, o),
  );
  action(
    filters(archive.command("search"))
      .requiredOption("--q <query>", "Retained message text query")
      .option("--user-id <id>", "Slack author filter"),
    (s, o) => s.searchArchivedMessages(o.connectionId, o.q, o),
  );
  action(
    conversation(archive.command("backfill"))
      .option("--thread-ts <timestamp>", "Import a specific thread")
      .option("--restart", "Restart a completed or failed import"),
    (s, o) => s.archiveBackfill(o.connectionId, o.conversationId, o),
  );
  action(page(connection(archive.command("coverage"))), (s, o) =>
    s.listArchiveCoverage(o.connectionId, o),
  );
  action(
    connection(
      archive
        .command("purge")
        .description(
          "Organization management: disable capture and queue retained-content deletion",
        ),
    ),
    (s, o) => s.purgeArchive(o.connectionId),
  );
}
