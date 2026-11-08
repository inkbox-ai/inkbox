import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import type { ChatAnswer, ScheduleFields, ScheduleTiming } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

function resource(command: Command, handle: string) {
  return createClient(getGlobalOpts(command)).identities.workspace(handle);
}
function show(command: Command, value: unknown) {
  output(value, { json: !!getGlobalOpts(command).json });
}
function object(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Expected a JSON object");
  return parsed as Record<string, unknown>;
}
function version(value: string) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("Expected a nonnegative version");
  return n;
}

export function registerWorkspaceCommands(hosting: Command): void {
  const chat = hosting
    .command("chat")
    .description("Retained chat, approvals and questions");
  chat.command("list <handle>").action(
    withErrorHandler(async function (this: Command, handle: string) {
      show(this, await resource(this, handle).conversations());
    }),
  );
  chat
    .command("create <handle>")
    .option("--title <text>", "Conversation title", "")
    .requiredOption("--idempotency-key <key>")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        o: { title: string; idempotencyKey: string },
      ) {
        show(
          this,
          await resource(this, handle).createConversation(
            o.title,
            o.idempotencyKey,
          ),
        );
      }),
    );
  chat.command("get <handle> <conversation>").action(
    withErrorHandler(async function (this: Command, h: string, c: string) {
      show(this, await resource(this, h).snapshot(c));
    }),
  );
  chat
    .command("messages <handle> <conversation>")
    .option("--after <cursor>")
    .option("--snapshot <token>")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        c: string,
        o: { after?: string; snapshot?: string },
      ) {
        show(this, await resource(this, h).messages(c, o.after, o.snapshot));
      }),
    );
  chat
    .command("events <handle> <conversation>")
    .option("--after <cursor>")
    .option("--follow", "Stream events as JSON lines")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        c: string,
        o: { after?: string; follow?: boolean },
      ) {
        if (o.follow) {
          for await (const event of resource(this, h).streamEvents(
            c,
            o.after,
          )) {
            process.stdout.write(JSON.stringify(event) + "\n");
          }
        } else {
          show(this, await resource(this, h).events(c, o.after));
        }
      }),
    );
  chat
    .command("send <handle> <conversation>")
    .requiredOption("--message <text>")
    .option("--model <model>", "Model for this turn (default: gpt-5.4)")
    .option("--file-id <id...>", "Uploaded file references")
    .requiredOption("--idempotency-key <key>")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        c: string,
        o: { message: string; fileId?: string[]; idempotencyKey: string; model?: string },
      ) {
        show(
          this,
          await resource(this, h).send(
            c,
            [
              { type: "text", text: o.message },
              ...(o.fileId ?? []).map((file_id) => ({
                type: "file" as const,
                file_id,
              })),
            ],
            o.idempotencyKey,
            o.model,
          ),
        );
      }),
    );
  chat.command("turn <handle> <conversation> <turn>").action(
    withErrorHandler(async function (
      this: Command,
      h: string,
      c: string,
      t: string,
    ) {
      show(this, await resource(this, h).turn(c, t));
    }),
  );
  chat
    .command("cancel <handle> <conversation> <turn>")
    .requiredOption("--idempotency-key <key>")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        c: string,
        t: string,
        o: { idempotencyKey: string },
      ) {
        show(this, await resource(this, h).cancel(c, t, o.idempotencyKey));
      }),
    );
  chat
    .command("respond <handle> <conversation> <interaction>")
    .requiredOption("--expected-version <version>")
    .requiredOption("--response <json>", "Typed approval or question response")
    .requiredOption("--idempotency-key <key>")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        c: string,
        i: string,
        o: {
          expectedVersion: string;
          response: string;
          idempotencyKey: string;
        },
      ) {
        show(
          this,
          await resource(this, h).respond(
            c,
            i,
            version(o.expectedVersion),
            object(o.response) as unknown as ChatAnswer,
            o.idempotencyKey,
          ),
        );
      }),
    );
  chat
    .command("upload <handle> <path>")
    .requiredOption("--name <name>")
    .option(
      "--media-type <type>",
      "File media type",
      "application/octet-stream",
    )
    .requiredOption("--idempotency-key <key>")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        path: string,
        o: { name: string; mediaType: string; idempotencyKey: string },
      ) {
        const data = await readFile(path);
        if (data.length > 262144)
          throw new Error("Files must be at most 256 KiB");
        show(
          this,
          await resource(this, h).uploadFile(
            o.name,
            data.toString("base64"),
            o.idempotencyKey,
            o.mediaType,
          ),
        );
      }),
    );
  chat.command("download <handle> <file-id> <path>").action(
    withErrorHandler(async function (
      this: Command,
      h: string,
      id: string,
      path: string,
    ) {
      const file = await resource(this, h).downloadFile(id);
      await writeFile(path, Buffer.from(file.data_base64, "base64"), {
        flag: "wx",
        mode: 0o600,
      });
      show(this, { saved: path });
    }),
  );
  const workspace = hosting
    .command("workspace")
    .description("Computer, environment, terminal and schedule controls");
  for (const [name, method] of [
    ["get", "status"],
    ["environment", "environment"],
    ["usage", "usage"],
    ["terminals", "terminals"],
    ["schedules", "schedules"],
  ] as const) {
    workspace.command(`${name} <handle>`).action(
      withErrorHandler(async function (this: Command, h: string) {
        show(this, await resource(this, h)[method]());
      }),
    );
  }
  for (const action of ["start", "stop"] as const) {
    workspace
      .command(`${action} <handle>`)
      .requiredOption("--idempotency-key <key>")
      .action(
        withErrorHandler(async function (
          this: Command,
          h: string,
          o: { idempotencyKey: string },
        ) {
          show(this, await resource(this, h)[action](o.idempotencyKey));
        }),
      );
  }
  workspace.command("operation <handle> <id>").action(
    withErrorHandler(async function (this: Command, h: string, id: string) {
      show(this, await resource(this, h).operation(id));
    }),
  );
  workspace
    .command("set-environment <handle>")
    .requiredOption("--file <path>", "Versioned environment update JSON file")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        o: { file: string },
      ) {
        show(
          this,
          await resource(this, h).updateEnvironment(
            object(await readFile(o.file, "utf8")),
          ),
        );
      }),
    );
  workspace
    .command("new-terminal <handle>")
    .requiredOption("--idempotency-key <key>")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        o: { idempotencyKey: string },
      ) {
        show(
          this,
          await resource(this, h).createTerminal(
            {
              argv: ["/bin/bash", "-l"],
              cwd: "/home/agent",
              pty: { rows: 24, cols: 80 },
            },
            o.idempotencyKey,
          ),
        );
      }),
    );
  workspace.command("terminal-ticket <handle> <id>").action(
    withErrorHandler(async function (this: Command, h: string, id: string) {
      show(this, await resource(this, h).terminalTicket(id));
    }),
  );
  workspace
    .command("close-terminal <handle> <id>")
    .requiredOption("--idempotency-key <key>")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        id: string,
        o: { idempotencyKey: string },
      ) {
        show(this, await resource(this, h).closeTerminal(id, o.idempotencyKey));
      }),
    );
  workspace
    .command("create-schedule <handle>")
    .requiredOption("--fields <json>")
    .requiredOption("--idempotency-key <key>")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        o: { fields: string; idempotencyKey: string },
      ) {
        show(
          this,
          await resource(this, h).createSchedule(
            object(o.fields) as ScheduleFields,
            o.idempotencyKey,
          ),
        );
      }),
    );
  workspace
    .command("update-schedule <handle> <id>")
    .requiredOption("--expected-revision <revision>")
    .requiredOption("--fields <json>")
    .requiredOption("--idempotency-key <key>")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        id: string,
        o: { expectedRevision: string; fields: string; idempotencyKey: string },
      ) {
        show(
          this,
          await resource(this, h).updateSchedule(
            id,
            version(o.expectedRevision),
            object(o.fields) as ScheduleFields,
            o.idempotencyKey,
          ),
        );
      }),
    );
  workspace
    .command("delete-schedule <handle> <id>")
    .requiredOption("--expected-revision <revision>")
    .requiredOption("--idempotency-key <key>")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        id: string,
        o: { expectedRevision: string; idempotencyKey: string },
      ) {
        show(
          this,
          await resource(this, h).deleteSchedule(
            id,
            version(o.expectedRevision),
            o.idempotencyKey,
          ),
        );
      }),
    );
  workspace
    .command("preview-schedule <handle>")
    .requiredOption("--timing <json>")
    .action(
      withErrorHandler(async function (
        this: Command,
        h: string,
        o: { timing: string },
      ) {
        show(
          this,
          await resource(this, h).previewSchedule(
            object(o.timing) as ScheduleTiming,
          ),
        );
      }),
    );
  workspace.command("schedule-history <handle> <id>").action(
    withErrorHandler(async function (this: Command, h: string, id: string) {
      show(this, await resource(this, h).scheduleHistory(id));
    }),
  );
}
