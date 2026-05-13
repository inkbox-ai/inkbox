import * as fs from "node:fs";
import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerTunnelCommands(program: Command): void {
  const tunnel = program
    .command("tunnel")
    .description(
      "Tunnel read + update + sign-csr. Tunnels are provisioned " +
        "atomically by 'inkbox identity create'; there is no standalone " +
        "create / delete / restore / rotate-secret surface.",
    );

  tunnel
    .command("list")
    .description("List all tunnels in your org")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const tunnels = await inkbox.tunnels.list();
        output(tunnels, {
          json: !!opts.json,
          columns: [
            "tunnelName",
            "publicHost",
            "tlsMode",
            "status",
            "id",
            "createdAt",
          ],
        });
      }),
    );

  tunnel
    .command("get <id-or-handle>")
    .description(
      "Fetch a tunnel by UUID, or by agent handle (resolves the " +
        "owning identity's nested tunnel).",
    )
    .action(
      withErrorHandler(async function (this: Command, idOrHandle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        // UUID heuristic: 8-4-4-4-12 hex.
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          idOrHandle,
        );
        const t = isUuid
          ? await inkbox.tunnels.get(idOrHandle)
          : (await inkbox.getIdentity(idOrHandle)).tunnel;
        if (!t) {
          throw new Error(
            `identity '${idOrHandle}' has no tunnel (only reachable on a deleted identity)`,
          );
        }
        output(
          {
            id: t.id,
            tunnelName: t.tunnelName,
            publicHost: t.publicHost,
            zone: t.zone,
            tlsMode: t.tlsMode,
            status: t.status,
            description: t.description,
            currentlyConnected: t.currentlyConnected,
            lastConnectedAt: t.lastConnectedAt,
            metadata: t.metadata,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          },
          { json: !!opts.json },
        );
      }),
    );

  tunnel
    .command("update <id>")
    .description(
      "Update a tunnel's description and/or metadata. Pass --description '' to clear.",
    )
    .option("--description <text>", "New description (pass '' to clear)")
    .option(
      "--metadata <json>",
      "New metadata as a JSON object (pass '{}' to clear)",
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        tunnelId: string,
        cmdOpts: { description?: string; metadata?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const body: {
          description?: string | null;
          metadata?: Record<string, unknown> | null;
        } = {};
        if (cmdOpts.description !== undefined) {
          body.description = cmdOpts.description === "" ? null : cmdOpts.description;
        }
        if (cmdOpts.metadata !== undefined) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(cmdOpts.metadata);
          } catch (err) {
            throw new Error(`--metadata is not valid JSON: ${(err as Error).message}`);
          }
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("--metadata must be a JSON object");
          }
          body.metadata = parsed as Record<string, unknown>;
        }
        const t = await inkbox.tunnels.update(tunnelId, body);
        output(
          {
            id: t.id,
            tunnelName: t.tunnelName,
            description: t.description,
            metadata: t.metadata,
          },
          { json: !!opts.json },
        );
      }),
    );

  tunnel
    .command("sign-csr <id>")
    .description(
      "Sign a CSR for a passthrough tunnel. The server runs DNS " +
        "validation + cert issuance synchronously (up to ~3 min).",
    )
    .requiredOption(
      "--csr <path-or-pem>",
      "CSR PEM bytes inline, or a file path to a CSR file.",
    )
    .option(
      "--out <path>",
      "Write the signed cert + chain to this file. Defaults to stdout.",
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        tunnelId: string,
        cmdOpts: { csr: string; out?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        let csrPem = cmdOpts.csr;
        if (!csrPem.includes("BEGIN CERTIFICATE REQUEST")) {
          // Treat as a file path.
          csrPem = fs.readFileSync(csrPem, "utf-8");
        }
        const signed = await inkbox.tunnels.signCsr(tunnelId, { csrPem });
        const combined = `${signed.certPem.replace(/\n?$/, "\n")}${signed.chainPem.replace(/\n?$/, "\n")}`;
        if (cmdOpts.out) {
          fs.writeFileSync(cmdOpts.out, combined);
          output(
            {
              certPem: cmdOpts.out,
              certFingerprintSha256: signed.certFingerprintSha256,
              certExpiresAt: signed.certExpiresAt,
            },
            { json: !!opts.json },
          );
        } else {
          process.stdout.write(combined);
        }
      }),
    );
}
