import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import type { SlackArchiveInclude, SlackCachedMediaKind, SlackProcessingStatus, SlackResource,
  SlackTaskChunk, SlackTaskDisplayMode } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import { slackInteger } from "./slack.js";

interface Args {
  connectionId: string;
  conversationId: string;
  messageTs: string;
  idempotencyKey: string;
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
  retentionDays?: number | "null";
  beforeTs?: string;
  afterTs?: string;
  q: string;
  restart?: boolean;
  rootsOnly?: boolean;
  include?: SlackArchiveInclude[];
  kind: SlackCachedMediaKind;
  resourceId: string;
  fileId: string;
  output: string;
  streamId: string;
  recipientUserId: string;
  recipientTeamId: string;
  taskDisplayMode: SlackTaskDisplayMode;
  chunks: SlackTaskChunk[];
}
function taskChunks(value: string): SlackTaskChunk[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new InvalidArgumentError("--chunks must be a JSON array of task_update or plan_update objects"); }
  if (!Array.isArray(parsed) || !parsed.every(chunk => chunk && typeof chunk === "object"
      && (chunk.type === "task_update" || chunk.type === "plan_update")))
    throw new InvalidArgumentError("--chunks must be a JSON array of task_update or plan_update objects");
  return parsed as SlackTaskChunk[];
}
function includes(value: string): SlackArchiveInclude[] {
  const names = value.split(",").map(name => name.trim());
  if (!names.every(name => ["conversation", "sender", "reactions", "files"].includes(name)))
    throw new InvalidArgumentError("Use conversation,sender,reactions,files for --include");
  return names as SlackArchiveInclude[];
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
  action(key(connection(operations.command("get-by-key")))
    .description("Recover an operation by its original key without repeating the write"),
    (s, o) => s.getOperationByKey(o.connectionId, o));
  const streams = slack.command("stream").description("Native threaded task progress; never automatically retried");
  action(key(conversation(streams.command("start")))
    .requiredOption("--thread-ts <timestamp>", "Original thread timestamp")
    .requiredOption("--recipient-user-id <id>", "Original Slack recipient user ID")
    .requiredOption("--recipient-team-id <id>", "Original Slack recipient workspace ID")
    .requiredOption("--chunks <json>", "JSON array of 1..20 task_update or plan_update chunks", taskChunks)
    .addOption(new Option("--task-display-mode <mode>", "Task presentation").choices(["timeline", "plan"]).default("timeline")),
    (s, o) => s.startStream(o.connectionId, o.conversationId, o));
  action(key(conversation(streams.command("append")))
    .requiredOption("--stream-id <id>", "Successful start operation UUID, not a message timestamp")
    .requiredOption("--chunks <json>", "JSON array of 1..20 task chunks", taskChunks),
    (s, o) => s.appendStream(o.connectionId, o.conversationId, o.streamId, o));
  action(key(conversation(streams.command("stop")))
    .requiredOption("--stream-id <id>", "Successful start operation UUID, not a message timestamp")
    .option("--chunks <json>", "Optional final task chunks, at most 20", taskChunks),
    (s, o) => s.stopStream(o.connectionId, o.conversationId, o.streamId, o));
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
      "Retained history; automatic observed-message capture, bounded imports, and coverage",
    );
  const settings = archive.command("settings");
  action(connection(settings.command("get")), (s, o) =>
    s.getArchiveSettings(o.connectionId),
  );
  action(
    connection(
      settings
        .command("update")
        .description(
          "Organization management: set retention; messages are captured automatically",
        ),
    )
      .option(
        "--retention-days <days|null>",
        "Retention limit; null or omission resets to no time limit",
        (v) => (v === "null" ? "null" : slackInteger(v)),
      ),
    (s, o) =>
      s.updateArchiveSettings(o.connectionId, {
        retentionDays: o.retentionDays === "null" ? null : o.retentionDays,
      }),
  );
  const filters = (c: Command): Command =>
    page(connection(c))
      .option("--conversation-id <id>", "Conversation filter")
      .option("--before-ts <timestamp>", "Exclusive upper timestamp")
      .option("--after-ts <timestamp>", "Exclusive lower timestamp");
  action(
    filters(archive.command("messages"))
      .option("--thread-ts <timestamp>", "Thread filter (requires conversation)")
      .option("--latest-per-conversation", "Return one latest message per conversation")
      .option("--roots-only", "Page roots, broadcasts, and replies whose root is unavailable")
      .option("--include <expansions>", "Comma-separated conversation,sender,reactions,files", includes),
    (s, o) => s.listArchivedMessages(o.connectionId, o),
  );
  const emoji = slack.command("emoji").description("Search the cached workspace emoji directory");
  action(page(connection(emoji.command("list"))).option("--q <query>", "Filter emoji names"),
    (s, o) => s.listCachedEmoji(o.connectionId, o));
  action(connection(slack.command("cached-media-download"))
    .requiredOption("--kind <kind>", "user, bot, or emoji", value => {
      if (!["user", "bot", "emoji"].includes(value)) throw new InvalidArgumentError("Expected user, bot, or emoji");
      return value;
    })
    .requiredOption("--resource-id <id>", "User ID, bot ID, or emoji name")
    .requiredOption("--output <path>", "New output path; never overwritten"), async (s, o) => {
      const bytes = await s.downloadCachedMedia(o.connectionId, o.kind, o.resourceId);
      await writeFile(o.output, bytes, { flag: "wx", mode: 0o600 });
      return { path: o.output, bytes: bytes.length };
    });
  connection(groups.files.command("preview [file-id]"))
    .description("Download a cached file preview")
    .option("--file-id <id>", "Alternative to the positional file ID")
    .requiredOption("--output <path>", "New output path; never overwritten")
    .action(withErrorHandler(async function (this: Command, fileId: string | undefined, o: Args) {
      if (fileId && o.fileId) throw new InvalidArgumentError("Pass either a positional file ID or --file-id, not both");
      const id = fileId ?? o.fileId;
      if (!id) throw new InvalidArgumentError("A file ID is required");
      const opts = getGlobalOpts(this);
      const bytes = await createClient(opts).slack.downloadFilePreview(o.connectionId, id);
      await writeFile(o.output, bytes, { flag: "wx", mode: 0o600 });
      output({ path: o.output, bytes: bytes.length }, { json: !!opts.json });
    }));
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
          "Organization management: delete retained history without stopping new capture",
        ),
    ),
    (s, o) => s.purgeArchive(o.connectionId),
  );
}
