import { registerSlackOperationCommands } from "./slack-operations.js";
import { readFile, stat, writeFile } from "node:fs/promises";
import { Command, InvalidArgumentError } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import { redactSecretError } from "../invitation-token.js";

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

async function readWorkspaceCredentials(file: string): Promise<{ accessToken: string; refreshToken: string }> {
  const maxBytes = 16384;
  let text = "";
  if (file === "-") {
    if (process.stdin.isTTY) throw new InvalidArgumentError("Provide credential JSON through stdin or a file.");
    for await (const chunk of process.stdin) {
      text += chunk.toString();
      if (Buffer.byteLength(text) > maxBytes) throw new InvalidArgumentError("Credential JSON is too large.");
    }
  } else {
    if ((await stat(file)).size > maxBytes) throw new InvalidArgumentError("Credential JSON is too large.");
    text = await readFile(file, "utf8");
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new InvalidArgumentError("Credential file must contain valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidArgumentError("Provide access_token and refresh_token in a JSON object.");
  }
  const data = value as Record<string, unknown>;
  if (typeof data.access_token !== "string" || !data.access_token.trim()
      || typeof data.refresh_token !== "string" || !data.refresh_token.trim()) {
    throw new InvalidArgumentError("Both access_token and refresh_token are required.");
  }
  return { accessToken: data.access_token.trim(), refreshToken: data.refresh_token.trim() };
}

export function registerSlackCommands(program: Command): void {
  const slack = program
    .command("slack")
    .description(
      "Slack workspace connections, live conversations, messages, and files",
    );
  const app = slack.command("app").description("Read Slack app status; permanent deletion is a human Console action");
  identity(app.command("status"))
    .description("Show current app and latest cleanup status without changing either")
    .action(withErrorHandler(async function (this: Command, o: IdentityOptions) {
      const opts = getGlobalOpts(this);
      const client = createClient(opts);
      output(await client.slack.getApplication(await resolveIdentityId(client, o)), { json: !!opts.json });
    }));
  const history = slack.command("history").description("Retained workspace history across app replacements");
  identity(history.command("workspaces"))
    .description("List saved workspace histories and optional live connection IDs")
    .action(withErrorHandler(async function (this: Command, o: IdentityOptions) {
      const opts = getGlobalOpts(this);
      const client = createClient(opts);
      output(await client.slack.listHistoryWorkspaces(await resolveIdentityId(client, o)), { json: !!opts.json });
    }));
  page(identity(history.command("messages")))
    .description("Browse or search one retained page; captured connection IDs are provenance, not write targets")
    .option("--workspace-id <id>", "Slack workspace ID; omit for all retained workspaces")
    .option("--q <text>", "Search retained message text")
    .option("--conversation-id <id>", "Slack conversation ID")
    .option("--thread-ts <timestamp>", "Exact thread; requires --conversation-id")
    .option("--user-id <id>", "Slack author user ID")
    .option("--after-ts <timestamp>", "Messages after this Slack timestamp")
    .option("--before-ts <timestamp>", "Messages before this Slack timestamp")
    .option("--latest-per-conversation", "Return the latest matching message per conversation")
    .action(withErrorHandler(async function (this: Command, o: IdentityOptions & {
      workspaceId?: string; q?: string; conversationId?: string; threadTs?: string; userId?: string;
      afterTs?: string; beforeTs?: string; cursor?: string; limit?: number; latestPerConversation?: boolean;
    }) {
      if (o.threadTs && !o.conversationId) throw new InvalidArgumentError("--thread-ts requires --conversation-id");
      const opts = getGlobalOpts(this);
      const client = createClient(opts);
      output(await client.slack.listHistoryMessages(await resolveIdentityId(client, o), o), { json: !!opts.json });
    }));
  identity(history.command("sources"))
    .description("Show the source installations of an authorized retained message")
    .requiredOption("--message-id <id>", "Retained Inkbox message UUID")
    .action(withErrorHandler(async function (this: Command, o: IdentityOptions & { messageId: string }) {
      const opts = getGlobalOpts(this);
      const client = createClient(opts);
      output(await client.slack.listMessageSources(await resolveIdentityId(client, o), o.messageId), { json: !!opts.json });
    }));
  const workspaces = slack.command("provisioning-workspace")
    .description("Manage saved app-configuration workspaces for your organization");
  workspaces.command("list")
    .description("List saved workspace metadata; no credentials are returned")
    .action(withErrorHandler(async function (this: Command) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).slack.listProvisioningWorkspaces(), { json: !!opts.json });
    }));
  workspaces.command("save")
    .description("Verify and save configuration credentials for your organization")
    .requiredOption("--credentials-file <path>", "JSON file with access_token and refresh_token; use - for stdin")
    .action(withErrorHandler(async function (this: Command, o: { credentialsFile: string }) {
      const opts = getGlobalOpts(this);
      const credentials = await readWorkspaceCredentials(o.credentialsFile);
      try {
        output(await createClient(opts).slack.saveProvisioningWorkspace(credentials), { json: !!opts.json });
      } catch (error) {
        throw redactSecretError(error, credentials.accessToken, credentials.refreshToken);
      }
    }));
  const setup = slack
    .command("setup")
    .description("Prepare a Slack app; claimed agent keys use their own identity");
  identity(setup.command("start"))
    .description("Start preparation without waiting; use connection list to check progress")
    .requiredOption("--provisioning-workspace-id <id>", "Saved provisioning workspace UUID")
    .action(
      withErrorHandler(async function (this: Command, o: IdentityOptions & { provisioningWorkspaceId: string }) {
        const opts = getGlobalOpts(this);
        const client = createClient(opts);
        output(await client.slack.startSetup(await resolveIdentityId(client, o), o.provisioningWorkspaceId), {
          json: !!opts.json,
        });
      }),
    );
  page(identity(slack.command("search")))
    .description(
      "Search retained messages across an identity's workspaces; agent credentials infer identity",
    )
    .requiredOption("--q <query>", "Retained message text query (1..512 characters)")
    .option("--connection-id <id>", "Narrow to one workspace connection UUID")
    .option("--conversation-id <id>", "Conversation filter")
    .option("--user-id <id>", "Slack author filter")
    .option("--before-ts <timestamp>", "Exclusive upper timestamp, as a string")
    .option("--after-ts <timestamp>", "Exclusive lower timestamp, as a string")
    .addHelpText(
      "after",
      "\nOther credentials require --identity or --identity-id. Page size: 1..100 (default 50). Follow nextCursor even for short or empty pages.",
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        o: IdentityOptions & { q: string },
      ) {
        const opts = getGlobalOpts(this);
        const client = createClient(opts);
        const identityId =
          o.identity !== undefined || o.identityId !== undefined
            ? await resolveIdentityId(client, o)
            : undefined;
        output(await client.slack.searchMessages({ ...o, identityId }), {
          json: !!opts.json,
        });
      }),
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
  const installations = slack
    .command("installation")
    .description("Start browser installation; claimed agent keys use their own identity");
  identity(
    installations
      .command("start")
      .description(
        "Return a short-lived secret URL to open in a browser; do not log or share it",
      ),
  )
    .option("--workspace-id <id>", "Expected Slack workspace ID")
    .option(
      "--return-url <url>",
      "Approved Console completion URL (default: standard completion page)",
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        o: IdentityOptions & { workspaceId?: string; returnUrl?: string },
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
  connection(actions.command("get-by-key"))
    .description("Read a send by its original key; not found does not mean safe to resend")
    .requiredOption("--idempotency-key <key>", "Original send key")
    .action(withErrorHandler(async function (
      this: Command,
      o: { connectionId: string; idempotencyKey: string },
    ) {
      const opts = getGlobalOpts(this);
      output(await createClient(opts).slack.getActionByKey(o.connectionId, o.idempotencyKey), {
        json: !!opts.json,
      });
    }));
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
