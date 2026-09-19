import { registerSlackOperationCommands } from "./slack-operations.js";
import { writeFile } from "node:fs/promises";
import { Command, InvalidArgumentError } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function slackInteger(value: string): number {
  if (
    !/^[0-9]+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    throw new InvalidArgumentError("Expected a positive integer");
  return Number(value);
}
interface IdentityOptions {
  identity?: string;
  identityId?: string;
}
const identity = (c: Command): Command =>
  c
    .option("-i, --identity <handle>", "Owning Inkbox identity handle")
    .option("--identity-id <id>", "Owning identity UUID instead of --identity");
async function resolveIdentityId(
  client: ReturnType<typeof createClient>,
  options: IdentityOptions,
): Promise<string> {
  if (!!options.identity === !!options.identityId)
    throw new InvalidArgumentError(
      "Provide exactly one of --identity or --identity-id",
    );
  if (options.identityId) return options.identityId;
  return (await client.getIdentity(options.identity!)).id;
}
const connection = (c: Command): Command =>
  c.requiredOption("--connection-id <id>", "Slack workspace connection UUID");
const conversation = (c: Command): Command =>
  connection(c).requiredOption(
    "--conversation-id <id>",
    "Slack conversation ID",
  );
const page = (c: Command): Command =>
  c
    .option("--limit <n>", "One page size", slackInteger)
    .option("--cursor <cursor>", "Next-page cursor; no automatic pagination");

export function registerSlackCommands(program: Command): void {
  const slack = program
    .command("slack")
    .description(
      "Slack workspace connections, live conversations, messages, and files",
    );
  const connections = slack
    .command("connection")
    .description("Manage workspace connections");
  identity(
    connections
      .command("list")
      .description("List connections and installation availability"),
  ).action(
    withErrorHandler(async function (this: Command, o: IdentityOptions) {
      const opts = getGlobalOpts(this);
      const client = createClient(opts);
      output(
        await client.slack.listConnections(await resolveIdentityId(client, o)),
        {
          json: !!opts.json,
        },
      );
    }),
  );
  connection(
    connections
      .command("disconnect")
      .description("Remove Inkbox authority; does not uninstall the Slack app"),
  ).action(
    withErrorHandler(async function (
      this: Command,
      o: { connectionId: string },
    ) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).slack.disconnect(o.connectionId), {
        json: !!opts.json,
      });
    }),
  );
  const invites = slack
    .command("invitation")
    .description("Organization management: workspace installation invitations");
  identity(
    invites
      .command("create")
      .description(
        "Create a one-time invitation URL; open it in the installer's browser",
      ),
  )
    .option(
      "--expires-in-seconds <n>",
      "Invitation lifetime: 300..604800 seconds (default 86400)",
      slackInteger,
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        o: IdentityOptions & { expiresInSeconds?: number },
      ) {
        const opts = getGlobalOpts(this);
        const client = createClient(opts);
        output(
          await client.slack.createInvitation(
            await resolveIdentityId(client, o),
            o,
          ),
          { json: !!opts.json },
        );
      }),
    );
  identity(
    invites
      .command("list")
      .description(
        "List invitation status; links are only returned at creation",
      ),
  ).action(
    withErrorHandler(async function (this: Command, o: IdentityOptions) {
      const opts = getGlobalOpts(this);
      const client = createClient(opts);
      output(
        await client.slack.listInvitations(await resolveIdentityId(client, o)),
        {
          json: !!opts.json,
        },
      );
    }),
  );
  const installations = slack
    .command("installation")
    .description("Organization management: browser installation handoff");
  identity(
    installations
      .command("start")
      .description(
        "Return a short-lived secret URL to open in a browser; do not log or share it",
      ),
  )
    .option("--workspace-id <id>", "Expected Slack workspace ID")
    .action(
      withErrorHandler(async function (
        this: Command,
        o: IdentityOptions & { workspaceId?: string },
      ) {
        const opts = getGlobalOpts(this);
        const client = createClient(opts);
        output(
          await client.slack.startInstallation(
            await resolveIdentityId(client, o),
            o,
          ),
          { json: !!opts.json },
        );
      }),
    );
  invites
    .command("revoke <invitation-id>")
    .description("Revoke an unconsumed invitation")
    .action(
      withErrorHandler(async function (this: Command, id: string) {
        const opts = getGlobalOpts(this);
        output(await createClient(opts).slack.revokeInvitation(id), {
          json: !!opts.json,
        });
      }),
    );
  const conversations = slack
    .command("conversation")
    .description("Read live conversations and open direct messages");
  page(connection(conversations.command("list"))).action(
    withErrorHandler(async function (
      this: Command,
      o: { connectionId: string; limit?: number; cursor?: string },
    ) {
      const opts = getGlobalOpts(this);
      output(
        await createClient(opts).slack.listConversations(o.connectionId, o),
        { json: !!opts.json },
      );
    }),
  );
  conversation(conversations.command("get")).action(
    withErrorHandler(async function (
      this: Command,
      o: { connectionId: string; conversationId: string },
    ) {
      const opts = getGlobalOpts(this);
      output(
        await createClient(opts).slack.getConversation(
          o.connectionId,
          o.conversationId,
        ),
        { json: !!opts.json },
      );
    }),
  );
  connection(
    conversations
      .command("open")
      .description("Open a DM or group DM with 1..8 Slack users"),
  )
    .requiredOption(
      "--user-id <id>",
      "Slack user ID (repeatable)",
      (v: string, previous: string[] = []) => [...previous, v],
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        o: { connectionId: string; userId: string[] },
      ) {
        const opts = getGlobalOpts(this);
        output(
          await createClient(opts).slack.openConversation(
            o.connectionId,
            o.userId,
          ),
          { json: !!opts.json },
        );
      }),
    );
  const messages = slack
    .command("message")
    .description(
      "Read live history and send messages with stable idempotency keys",
    );
  page(conversation(messages.command("list")))
    .option("--thread-ts <timestamp>", "Slack thread timestamp (string)")
    .action(
      withErrorHandler(async function (
        this: Command,
        o: {
          connectionId: string;
          conversationId: string;
          limit?: number;
          cursor?: string;
          threadTs?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        output(
          await createClient(opts).slack.listMessages(
            o.connectionId,
            o.conversationId,
            o,
          ),
          { json: !!opts.json },
        );
      }),
    );
  conversation(
    messages
      .command("send")
      .description(
        "Send once; unknown is unresolved, not safe to blindly resend",
      ),
  )
    .requiredOption("--text <text>", "Message text (1..12000 characters)")
    .requiredOption(
      "--idempotency-key <key>",
      "Stable key for this exact operation; reuse only with the same body",
    )
    .option("--thread-ts <timestamp>", "Reply thread timestamp (string)")
    .action(
      withErrorHandler(async function (
        this: Command,
        o: {
          connectionId: string;
          conversationId: string;
          text: string;
          idempotencyKey: string;
          threadTs?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        output(await createClient(opts).slack.sendMessage(o.connectionId, o), {
          json: !!opts.json,
        });
      }),
    );
  const actions = slack
    .command("action")
    .description("Inspect durable send status; sent is not delivered or read");
  connection(actions.command("get <action-id>")).action(
    withErrorHandler(async function (
      this: Command,
      id: string,
      o: { connectionId: string },
    ) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).slack.getAction(o.connectionId, id), {
        json: !!opts.json,
      });
    }),
  );
  const files = slack
    .command("file")
    .description("Read authorized file metadata and download bytes");
  connection(files.command("get <file-id>")).action(
    withErrorHandler(async function (
      this: Command,
      id: string,
      o: { connectionId: string },
    ) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).slack.getFile(o.connectionId, id), {
        json: !!opts.json,
      });
    }),
  );
  connection(files.command("download <file-id>"))
    .requiredOption(
      "--output <path>",
      "New output file path (will not overwrite)",
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        id: string,
        o: { connectionId: string; output: string },
      ) {
        const opts = getGlobalOpts(this);
        const bytes = await createClient(opts).slack.downloadFile(
          o.connectionId,
          id,
        );
        await writeFile(o.output, bytes, { flag: "wx", mode: 0o600 });
        output({ path: o.output, bytes: bytes.length }, { json: !!opts.json });
      }),
    );
  registerSlackOperationCommands(slack, { conversations, messages, files });
}
