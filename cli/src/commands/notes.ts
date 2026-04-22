import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

function registerNotesAccessCommands(parent: Command): void {
  const access = parent
    .command("access")
    .description("Per-note access grants");

  access
    .command("list <note-id>")
    .description("List grants on a note")
    .action(
      withErrorHandler(async function (this: Command, noteId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rows = await inkbox.notes.access.list(noteId);
        output(rows, {
          json: !!opts.json,
          columns: ["id", "noteId", "identityId", "createdAt"],
        });
      }),
    );

  access
    .command("grant <note-id> <identity-id>")
    .description("Grant a specific identity access (admin + JWT only)")
    .action(
      withErrorHandler(async function (
        this: Command,
        noteId: string,
        identityId: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const grant = await inkbox.notes.access.grant(noteId, identityId);
        output(grant as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  access
    .command("revoke <note-id> <identity-id>")
    .description("Revoke a specific identity's grant (self-only for agents)")
    .action(
      withErrorHandler(async function (
        this: Command,
        noteId: string,
        identityId: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.notes.access.revoke(noteId, identityId);
        console.log(`Revoked identity ${identityId} on note ${noteId}.`);
      }),
    );
}

export function registerNotesCommands(program: Command): void {
  const notes = program
    .command("notes")
    .description("Org-scoped notes with per-identity grants");

  notes
    .command("list")
    .description("List accessible notes")
    .option("--q <query>", "Substring search (≤200 chars)")
    .option("--identity <uuid>", "Filter to notes visible to an identity")
    .option("--order <order>", "recent (default) or created")
    .option("--limit <n>", "Max rows (1–200, default 50)", (v) => parseInt(v, 10))
    .option("--offset <n>", "Offset", (v) => parseInt(v, 10))
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          q?: string;
          identity?: string;
          order?: string;
          limit?: number;
          offset?: number;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rows = await inkbox.notes.list({
          q: cmdOpts.q,
          identityId: cmdOpts.identity,
          order: cmdOpts.order,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        });
        output(rows, {
          json: !!opts.json,
          columns: ["id", "title", "createdBy", "status", "createdAt", "updatedAt"],
        });
      }),
    );

  notes
    .command("get <note-id>")
    .description("Fetch a single note with inlined grants")
    .action(
      withErrorHandler(async function (this: Command, noteId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const note = await inkbox.notes.get(noteId);
        output(note as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  notes
    .command("create")
    .description("Create a note")
    .requiredOption("--body <text>", "Body text (1–100 000 chars, required)")
    .option("--title <text>", "Optional title (≤200 chars)")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { body: string; title?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const note = await inkbox.notes.create({
          body: cmdOpts.body,
          title: cmdOpts.title,
        });
        output(note as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  notes
    .command("update <note-id>")
    .description("Update title and/or body")
    .option("--body <text>", "New body text")
    .option("--title <text>", 'New title (pass "" to clear)')
    .action(
      withErrorHandler(async function (
        this: Command,
        noteId: string,
        cmdOpts: { body?: string; title?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const patch: { body?: string; title?: string | null } = {};
        if (cmdOpts.body !== undefined) patch.body = cmdOpts.body;
        if (cmdOpts.title !== undefined) {
          patch.title = cmdOpts.title === "" ? null : cmdOpts.title;
        }
        const note = await inkbox.notes.update(noteId, patch);
        output(note as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  notes
    .command("delete <note-id>")
    .description("Delete a note")
    .action(
      withErrorHandler(async function (this: Command, noteId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.notes.delete(noteId);
        console.log(`Deleted note ${noteId}.`);
      }),
    );

  registerNotesAccessCommands(notes);
}
