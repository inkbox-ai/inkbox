import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import type {
  SecretPayload,
  MailRuleAction,
  MailRuleMatchType,
  PhoneRuleAction,
  PhoneRuleMatchType,
  ContactRuleStatus,
} from "@inkbox/sdk";
import { parseTotpUri } from "@inkbox/sdk";

const RULE_COLUMNS = [
  "id",
  "agentIdentityId",
  "action",
  "matchType",
  "matchTarget",
  "status",
];

function registerIdentityAccessCommands(parent: Command): void {
  const access = parent
    .command("access")
    .description("Manage who can see an identity (agent visibility)");

  access
    .command("list <target-handle>")
    .description("List who can see this identity")
    .action(
      withErrorHandler(async function (this: Command, targetHandle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const target = await inkbox.getIdentity(targetHandle);
        const rows = await target.listAccess();
        if (opts.json) {
          output(rows, { json: true });
          return;
        }
        // Render the wildcard sentinel (null viewer) as a readable label.
        const display = rows.map((r) => ({
          ...r,
          viewerIdentityId: r.viewerIdentityId ?? "(everyone)",
        }));
        output(display, {
          json: false,
          columns: ["id", "targetIdentityId", "viewerIdentityId", "createdAt"],
        });
      }),
    );

  access
    .command("grant <target-handle> <viewer-handle>")
    .description("Grant a viewer identity visibility on the target identity")
    .action(
      withErrorHandler(async function (
        this: Command,
        targetHandle: string,
        viewerHandle: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const target = await inkbox.getIdentity(targetHandle);
        const viewer = await inkbox.getIdentity(viewerHandle);
        const grant = await target.grantAccess(viewer.id);
        if (opts.json) {
          output(grant as unknown as Record<string, unknown>, { json: true });
        } else {
          console.log(
            `Granted '${viewerHandle}' visibility on '${targetHandle}'.`,
          );
        }
      }),
    );

  access
    .command("grant-everyone <target-handle>")
    .description(
      "Make the target visible to every active identity in the org (wildcard)",
    )
    .action(
      withErrorHandler(async function (this: Command, targetHandle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const target = await inkbox.getIdentity(targetHandle);
        const grant = await target.grantAccess(null);
        if (opts.json) {
          output(grant as unknown as Record<string, unknown>, { json: true });
        } else {
          console.log(
            `'${targetHandle}' is now visible to every active identity in the org.`,
          );
        }
      }),
    );

  access
    .command("revoke <target-handle> <viewer-handle>")
    .description("Revoke a viewer identity's visibility on the target identity")
    .action(
      withErrorHandler(async function (
        this: Command,
        targetHandle: string,
        viewerHandle: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const target = await inkbox.getIdentity(targetHandle);
        const viewer = await inkbox.getIdentity(viewerHandle);
        await target.revokeAccess(viewer.id);
        console.log(
          `Revoked '${viewerHandle}' visibility on '${targetHandle}'.`,
        );
      }),
    );
}

function registerIdentityMailRuleCommands(parent: Command): void {
  const rules = parent
    .command("mail-rules")
    .description("Mail contact rules scoped to an agent identity");

  rules
    .command("list <handle>")
    .description("List an identity's mail contact rules")
    .option("--action <action>", "Filter by action: allow or block")
    .option("--match-type <type>", "Filter by match_type: exact_email or domain")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10))
    .option("--offset <n>", "Offset", (v) => parseInt(v, 10))
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        cmdOpts: { action?: string; matchType?: string; limit?: number; offset?: number },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rows = await inkbox.mailIdentityContactRules.list(handle, {
          action: cmdOpts.action as MailRuleAction | undefined,
          matchType: cmdOpts.matchType as MailRuleMatchType | undefined,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        });
        output(rows, { json: !!opts.json, columns: RULE_COLUMNS });
      }),
    );

  rules
    .command("list-all")
    .description("List mail contact rules across the org (admin-only)")
    .option("--agent-identity-id <id>", "Narrow to a single agent identity id")
    .option("--action <action>", "Filter by action: allow or block")
    .option("--match-type <type>", "Filter by match_type: exact_email or domain")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10))
    .option("--offset <n>", "Offset", (v) => parseInt(v, 10))
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          agentIdentityId?: string;
          action?: string;
          matchType?: string;
          limit?: number;
          offset?: number;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rows = await inkbox.mailIdentityContactRules.listAll({
          agentIdentityId: cmdOpts.agentIdentityId,
          action: cmdOpts.action as MailRuleAction | undefined,
          matchType: cmdOpts.matchType as MailRuleMatchType | undefined,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        });
        output(rows, { json: !!opts.json, columns: RULE_COLUMNS });
      }),
    );

  rules
    .command("get <handle> <rule-id>")
    .description("Get a single mail contact rule")
    .action(
      withErrorHandler(async function (this: Command, handle: string, ruleId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.mailIdentityContactRules.get(handle, ruleId);
        output(rule as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  rules
    .command("create <handle>")
    .description("Create a mail contact rule (always starts active; use `update` to pause)")
    .requiredOption("--action <action>", "allow or block")
    .requiredOption("--match-type <type>", "exact_email or domain")
    .requiredOption("--match-target <value>", "Address or domain to match")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        cmdOpts: { action: string; matchType: string; matchTarget: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.mailIdentityContactRules.create(handle, {
          action: cmdOpts.action as MailRuleAction,
          matchType: cmdOpts.matchType as MailRuleMatchType,
          matchTarget: cmdOpts.matchTarget,
        });
        output(rule as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  rules
    .command("update <handle> <rule-id>")
    .description("Update action and/or status on a mail rule (admin-only)")
    .option("--action <action>", "allow or block")
    .option("--status <status>", "active or paused")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        ruleId: string,
        cmdOpts: { action?: string; status?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.mailIdentityContactRules.update(handle, ruleId, {
          action: cmdOpts.action as MailRuleAction | undefined,
          status: cmdOpts.status as ContactRuleStatus | undefined,
        });
        output(rule as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  rules
    .command("delete <handle> <rule-id>")
    .description("Delete a mail contact rule (admin-only)")
    .action(
      withErrorHandler(async function (this: Command, handle: string, ruleId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.mailIdentityContactRules.delete(handle, ruleId);
        console.log(`Deleted mail contact rule '${ruleId}' on '${handle}'.`);
      }),
    );
}

function registerIdentityPhoneRuleCommands(parent: Command): void {
  const rules = parent
    .command("phone-rules")
    .description("Phone contact rules scoped to an agent identity (requires a phone number)");

  rules
    .command("list <handle>")
    .description("List an identity's phone contact rules (empty if no phone number)")
    .option("--action <action>", "Filter by action: allow or block")
    .option("--match-type <type>", "Filter by match_type: exact_number")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10))
    .option("--offset <n>", "Offset", (v) => parseInt(v, 10))
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        cmdOpts: { action?: string; matchType?: string; limit?: number; offset?: number },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rows = await inkbox.phoneIdentityContactRules.list(handle, {
          action: cmdOpts.action as PhoneRuleAction | undefined,
          matchType: cmdOpts.matchType as PhoneRuleMatchType | undefined,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        });
        output(rows, { json: !!opts.json, columns: RULE_COLUMNS });
      }),
    );

  rules
    .command("list-all")
    .description("List phone contact rules across the org (admin-only)")
    .option("--agent-identity-id <id>", "Narrow to a single agent identity id")
    .option("--action <action>", "Filter by action: allow or block")
    .option("--match-type <type>", "Filter by match_type: exact_number")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10))
    .option("--offset <n>", "Offset", (v) => parseInt(v, 10))
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          agentIdentityId?: string;
          action?: string;
          matchType?: string;
          limit?: number;
          offset?: number;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rows = await inkbox.phoneIdentityContactRules.listAll({
          agentIdentityId: cmdOpts.agentIdentityId,
          action: cmdOpts.action as PhoneRuleAction | undefined,
          matchType: cmdOpts.matchType as PhoneRuleMatchType | undefined,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        });
        output(rows, { json: !!opts.json, columns: RULE_COLUMNS });
      }),
    );

  rules
    .command("get <handle> <rule-id>")
    .description("Get a single phone contact rule")
    .action(
      withErrorHandler(async function (this: Command, handle: string, ruleId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.phoneIdentityContactRules.get(handle, ruleId);
        output(rule as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  rules
    .command("create <handle>")
    .description("Create a phone contact rule (identity must have a phone number)")
    .requiredOption("--action <action>", "allow or block")
    .requiredOption("--match-target <value>", "E.164 phone number to match")
    .option("--match-type <type>", "Match type (default exact_number)", "exact_number")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        cmdOpts: { action: string; matchTarget: string; matchType: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.phoneIdentityContactRules.create(handle, {
          action: cmdOpts.action as PhoneRuleAction,
          matchTarget: cmdOpts.matchTarget,
          matchType: cmdOpts.matchType as PhoneRuleMatchType,
        });
        output(rule as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  rules
    .command("update <handle> <rule-id>")
    .description("Update action and/or status on a phone rule (admin-only)")
    .option("--action <action>", "allow or block")
    .option("--status <status>", "active or paused")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        ruleId: string,
        cmdOpts: { action?: string; status?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rule = await inkbox.phoneIdentityContactRules.update(handle, ruleId, {
          action: cmdOpts.action as PhoneRuleAction | undefined,
          status: cmdOpts.status as ContactRuleStatus | undefined,
        });
        output(rule as unknown as Record<string, unknown>, { json: !!opts.json });
      }),
    );

  rules
    .command("delete <handle> <rule-id>")
    .description("Delete a phone contact rule (admin-only)")
    .action(
      withErrorHandler(async function (this: Command, handle: string, ruleId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.phoneIdentityContactRules.delete(handle, ruleId);
        console.log(`Deleted phone contact rule '${ruleId}' on '${handle}'.`);
      }),
    );
}

function registerIdentitySigningKeyCommands(parent: Command): void {
  const signingKey = parent
    .command("signing-key")
    .description("Per-identity webhook signing key operations");

  signingKey
    .command("status <handle>")
    .description("Report whether this identity has a webhook signing key")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        const status = await id.getSigningKeyStatus();
        output(
          { configured: status.configured, createdAt: status.createdAt },
          { json: !!opts.json },
        );
      }),
    );

  signingKey
    .command("rotate <handle>")
    .description("Create or rotate this identity's webhook signing key")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        const key = await id.createSigningKey();
        output(
          { signingKey: key.signingKey, createdAt: key.createdAt },
          { json: !!opts.json },
        );
        console.error(
          "Note: Store this key securely — it cannot be retrieved again.",
        );
      }),
    );
}

export function registerIdentityCommands(program: Command): void {
  const identity = program
    .command("identity")
    .description("Manage agent identities");

  identity
    .command("list")
    .description("List all identities")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identities = await inkbox.listIdentities();
        output(identities, {
          json: !!opts.json,
          columns: ["agentHandle", "id", "createdAt"],
        });
      }),
    );

  identity
    .command("get <handle>")
    .description("Get identity details")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        output(
          {
            agentHandle: id.agentHandle,
            id: id.id,
            displayName: id.displayName,
            description: id.description,
            mailbox: id.mailbox?.emailAddress ?? null,
            phoneNumber: id.phoneNumber?.number ?? null,
            imessageEnabled: id.imessageEnabled,
            imessageFilterMode: id.imessageFilterMode,
            mailFilterMode: id.mailFilterMode,
            phoneFilterMode: id.phoneFilterMode,
            tunnel: id.tunnel
              ? {
                  id: id.tunnel.id,
                  publicHost: id.tunnel.publicHost,
                  zone: id.tunnel.zone,
                  tlsMode: id.tunnel.tlsMode,
                  status: id.tunnel.status,
                }
              : null,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("create <handle>")
    .description(
      "Create a new agent identity. Atomically provisions a mailbox " +
        "and tunnel; both come back on the JSON output.",
    )
    .option(
      "--display-name <name>",
      "Identity-level human-readable name. Defaults server-side to the handle.",
    )
    .option(
      "--description <text>",
      "Free-form org-internal description (never surfaces in outbound mail).",
    )
    .option(
      "--imessage-enabled",
      "Opt the identity into the shared iMessage service.",
      false,
    )
    .option(
      "--email-local-part <part>",
      "Requested mailbox local part. On the platform domain the server forces this to the handle.",
    )
    .option(
      "--sending-domain <name>",
      "Bare verified custom domain name to use for the agent's mailbox (e.g. 'mail.acme.com').",
    )
    .option(
      "--platform-domain",
      "Force the platform sending domain for the mailbox.",
      false,
    )
    .option(
      "--tls-mode <mode>",
      "Tunnel TLS mode: edge (default) or passthrough.",
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        cmdOpts: {
          displayName?: string;
          description?: string;
          imessageEnabled?: boolean;
          emailLocalPart?: string;
          sendingDomain?: string;
          platformDomain?: boolean;
          tlsMode?: string;
        },
      ) {
        if (cmdOpts.sendingDomain !== undefined && cmdOpts.platformDomain) {
          throw new Error("--sending-domain and --platform-domain are mutually exclusive");
        }
        if (cmdOpts.tlsMode !== undefined && cmdOpts.tlsMode !== "edge" && cmdOpts.tlsMode !== "passthrough") {
          throw new Error("--tls-mode must be 'edge' or 'passthrough'");
        }
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const createOpts: {
          displayName?: string;
          description?: string | null;
          imessageEnabled?: boolean;
          emailLocalPart?: string;
          sendingDomain?: string | null;
          tunnel?: { tlsMode?: "edge" | "passthrough" };
        } = {};
        if (cmdOpts.displayName !== undefined) createOpts.displayName = cmdOpts.displayName;
        if (cmdOpts.description !== undefined) createOpts.description = cmdOpts.description;
        if (cmdOpts.imessageEnabled) createOpts.imessageEnabled = true;
        if (cmdOpts.emailLocalPart !== undefined) createOpts.emailLocalPart = cmdOpts.emailLocalPart;
        if (cmdOpts.sendingDomain !== undefined) {
          createOpts.sendingDomain = cmdOpts.sendingDomain;
        } else if (cmdOpts.platformDomain) {
          createOpts.sendingDomain = null;
        }
        if (cmdOpts.tlsMode !== undefined) {
          createOpts.tunnel = { tlsMode: cmdOpts.tlsMode as "edge" | "passthrough" };
        }
        const id = await inkbox.createIdentity(handle, createOpts);
        output(
          {
            agentHandle: id.agentHandle,
            id: id.id,
            displayName: id.displayName,
            description: id.description,
            mailbox: id.mailbox?.emailAddress ?? null,
            imessageEnabled: id.imessageEnabled,
            tunnel: id.tunnel
              ? {
                  id: id.tunnel.id,
                  publicHost: id.tunnel.publicHost,
                  zone: id.tunnel.zone,
                  tlsMode: id.tunnel.tlsMode,
                  status: id.tunnel.status,
                }
              : null,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("delete <handle>")
    .description("Delete an identity. Cascades to the linked mailbox + tunnel and revokes scoped API keys.")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        await id.delete();
        console.log(`Deleted identity '${handle}'.`);
      }),
    );

  identity
    .command("update <handle>")
    .description(
      "Update an identity. For --description, an empty string clears " +
        "the column (sends explicit null); omit the flag to leave " +
        "untouched.",
    )
    .option("--new-handle <name>", "New handle")
    .option("--display-name <name>", "New display name (pass '' to clear)")
    .option("--description <text>", "New description (pass '' to clear)")
    .option("--clear-description", "Explicitly clear the description (sends null)", false)
    .option("--imessage-enabled <bool>", "Toggle shared-iMessage reachability: true or false")
    .option("--imessage-filter-mode <mode>", "iMessage contact-rule mode: whitelist or blacklist (admin-only)")
    .option("--mail-filter-mode <mode>", "Mail contact-rule mode: whitelist or blacklist (admin-only)")
    .option("--phone-filter-mode <mode>", "Phone contact-rule mode: whitelist or blacklist (admin-only; identity must have a phone number)")
    .option("--status <status>", "active or paused")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        cmdOpts: {
          newHandle?: string;
          displayName?: string;
          description?: string;
          clearDescription?: boolean;
          imessageEnabled?: string;
          imessageFilterMode?: string;
          mailFilterMode?: string;
          phoneFilterMode?: string;
          status?: string;
        },
      ) {
        if (cmdOpts.description !== undefined && cmdOpts.clearDescription) {
          throw new Error("--description and --clear-description are mutually exclusive");
        }
        if (cmdOpts.imessageEnabled !== undefined && cmdOpts.imessageEnabled !== "true" && cmdOpts.imessageEnabled !== "false") {
          throw new Error("--imessage-enabled must be 'true' or 'false'");
        }
        for (const [flag, value] of [
          ["--imessage-filter-mode", cmdOpts.imessageFilterMode],
          ["--mail-filter-mode", cmdOpts.mailFilterMode],
          ["--phone-filter-mode", cmdOpts.phoneFilterMode],
        ] as const) {
          if (value !== undefined && value !== "whitelist" && value !== "blacklist") {
            throw new Error(`${flag} must be 'whitelist' or 'blacklist'`);
          }
        }
        if (cmdOpts.status !== undefined && cmdOpts.status !== "active" && cmdOpts.status !== "paused") {
          throw new Error("--status must be 'active' or 'paused'");
        }
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        const updateOpts: {
          newHandle?: string;
          displayName?: string | null;
          description?: string | null;
          imessageEnabled?: boolean;
          imessageFilterMode?: "whitelist" | "blacklist";
          mailFilterMode?: "whitelist" | "blacklist";
          phoneFilterMode?: "whitelist" | "blacklist";
          status?: "active" | "paused";
        } = {};
        if (cmdOpts.newHandle !== undefined) updateOpts.newHandle = cmdOpts.newHandle;
        if (cmdOpts.displayName !== undefined) {
          updateOpts.displayName = cmdOpts.displayName === "" ? null : cmdOpts.displayName;
        }
        if (cmdOpts.description !== undefined) {
          updateOpts.description = cmdOpts.description === "" ? null : cmdOpts.description;
        } else if (cmdOpts.clearDescription) {
          updateOpts.description = null;
        }
        if (cmdOpts.imessageEnabled !== undefined) {
          updateOpts.imessageEnabled = cmdOpts.imessageEnabled === "true";
        }
        if (cmdOpts.imessageFilterMode !== undefined) {
          updateOpts.imessageFilterMode = cmdOpts.imessageFilterMode as "whitelist" | "blacklist";
        }
        if (cmdOpts.mailFilterMode !== undefined) {
          updateOpts.mailFilterMode = cmdOpts.mailFilterMode as "whitelist" | "blacklist";
        }
        if (cmdOpts.phoneFilterMode !== undefined) {
          updateOpts.phoneFilterMode = cmdOpts.phoneFilterMode as "whitelist" | "blacklist";
        }
        if (cmdOpts.status !== undefined) {
          updateOpts.status = cmdOpts.status as "active" | "paused";
        }
        await id.update(updateOpts);
        console.log(`Updated identity '${handle}'.`);
      }),
    );

  identity
    .command("refresh <handle>")
    .description("Re-fetch identity from API")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        await id.refresh();
        output(
          {
            agentHandle: id.agentHandle,
            id: id.id,
            displayName: id.displayName,
            description: id.description,
            mailbox: id.mailbox?.emailAddress ?? null,
            phoneNumber: id.phoneNumber?.number ?? null,
            imessageEnabled: id.imessageEnabled,
            imessageFilterMode: id.imessageFilterMode,
            mailFilterMode: id.mailFilterMode,
            phoneFilterMode: id.phoneFilterMode,
            tunnel: id.tunnel
              ? {
                  id: id.tunnel.id,
                  publicHost: id.tunnel.publicHost,
                  zone: id.tunnel.zone,
                  tlsMode: id.tunnel.tlsMode,
                  status: id.tunnel.status,
                }
              : null,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("create-secret <handle>")
    .description("Create a secret scoped to an identity (requires vault key)")
    .requiredOption("--name <name>", "Secret display name")
    .requiredOption(
      "--type <type>",
      "Secret type: login, api_key, ssh_key, key_pair, other",
    )
    .option("--description <desc>", "Optional description")
    .option("--username <user>", "Username (for login type)")
    .option("--password <pass>", "Password (for login type)")
    .option("--email <email>", "Email (for login type)")
    .option("--url <url>", "URL (for login type)")
    .option("--totp-uri <uri>", "otpauth:// TOTP URI (for login type)")
    .option("--key <key>", "API key value (for api_key type)")
    .option("--access-key <key>", "Access key (for key_pair type)")
    .option("--secret-key <key>", "Secret key (for key_pair type)")
    .option("--endpoint <url>", "Endpoint URL (for api_key and key_pair types)")
    .option("--private-key <key>", "Private key (for ssh_key type)")
    .option("--public-key <key>", "Public key (for ssh_key type)")
    .option("--fingerprint <fp>", "Key fingerprint (for ssh_key type)")
    .option("--passphrase <pass>", "Key passphrase (for ssh_key type)")
    .option("--data <json>", "JSON payload (for other type)")
    .option("--notes <text>", "Optional notes")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        cmdOpts: {
          name: string;
          type: string;
          description?: string;
          username?: string;
          password?: string;
          email?: string;
          url?: string;
          totpUri?: string;
          key?: string;
          accessKey?: string;
          secretKey?: string;
          endpoint?: string;
          privateKey?: string;
          publicKey?: string;
          fingerprint?: string;
          passphrase?: string;
          data?: string;
          notes?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        await inkbox.ready();
        const id = await inkbox.getIdentity(handle);

        let payload: SecretPayload;
        switch (cmdOpts.type) {
          case "login":
            if (!cmdOpts.password) {
              console.error(
                "Error: --password is required for login secrets.",
              );
              process.exit(1);
            }
            payload = {
              password: cmdOpts.password,
              username: cmdOpts.username,
              email: cmdOpts.email,
              url: cmdOpts.url,
              notes: cmdOpts.notes,
              ...(cmdOpts.totpUri
                ? { totp: parseTotpUri(cmdOpts.totpUri) }
                : {}),
            };
            break;
          case "api_key":
            if (!cmdOpts.key) {
              console.error(
                "Error: --key is required for api_key secrets.",
              );
              process.exit(1);
            }
            payload = {
              apiKey: cmdOpts.key,
              endpoint: cmdOpts.endpoint,
              notes: cmdOpts.notes,
            };
            break;
          case "key_pair":
            if (!cmdOpts.accessKey || !cmdOpts.secretKey) {
              console.error(
                "Error: --access-key and --secret-key are required for key_pair secrets.",
              );
              process.exit(1);
            }
            payload = {
              accessKey: cmdOpts.accessKey,
              secretKey: cmdOpts.secretKey,
              endpoint: cmdOpts.endpoint,
              notes: cmdOpts.notes,
            };
            break;
          case "ssh_key":
            if (!cmdOpts.privateKey) {
              console.error(
                "Error: --private-key is required for ssh_key secrets.",
              );
              process.exit(1);
            }
            payload = {
              privateKey: cmdOpts.privateKey,
              publicKey: cmdOpts.publicKey,
              fingerprint: cmdOpts.fingerprint,
              passphrase: cmdOpts.passphrase,
              notes: cmdOpts.notes,
            };
            break;
          case "other":
            if (!cmdOpts.data) {
              console.error(
                "Error: --data (JSON string) is required for other secrets.",
              );
              process.exit(1);
            }
            payload = {
              data: cmdOpts.data,
              notes: cmdOpts.notes,
            };
            break;
          default:
            console.error(
              `Error: Unknown secret type '${cmdOpts.type}'. Use: login, api_key, ssh_key, key_pair, other.`,
            );
            process.exit(1);
        }

        const secret = await id.createSecret({
          name: cmdOpts.name,
          description: cmdOpts.description,
          payload,
        });
        output(
          {
            id: secret.id,
            name: secret.name,
            secretType: secret.secretType,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("get-secret <handle> <secret-id>")
    .description("Get and decrypt a secret for an identity (requires vault key)")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        secretId: string,
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        await inkbox.ready();
        const id = await inkbox.getIdentity(handle);
        const secret = await id.getSecret(secretId);
        output(
          {
            id: secret.id,
            name: secret.name,
            secretType: secret.secretType,
            createdAt: secret.createdAt,
            payload: secret.payload,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("delete-secret <handle> <secret-id>")
    .description("Delete a secret for an identity (requires vault key)")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        secretId: string,
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        await inkbox.ready();
        const id = await inkbox.getIdentity(handle);
        await id.deleteSecret(secretId);
        console.log(`Deleted secret '${secretId}'.`);
      }),
    );

  identity
    .command("revoke-access <handle> <secret-id>")
    .description("Revoke an identity's access to a secret")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        secretId: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        await id.revokeCredentialAccess(secretId);
        console.log(
          `Revoked access to secret '${secretId}' for identity '${handle}'.`,
        );
      }),
    );

  identity
    .command("set-totp <handle> <secret-id>")
    .description("Add TOTP to a login secret (requires vault key)")
    .requiredOption("--uri <otpauth-uri>", "otpauth:// TOTP URI")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        secretId: string,
        cmdOpts: { uri: string },
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        await inkbox.ready();
        const id = await inkbox.getIdentity(handle);
        const secret = await id.setTotp(secretId, cmdOpts.uri);
        output(
          {
            id: secret.id,
            name: secret.name,
            secretType: secret.secretType,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("remove-totp <handle> <secret-id>")
    .description("Remove TOTP from a login secret (requires vault key)")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        secretId: string,
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        await inkbox.ready();
        const id = await inkbox.getIdentity(handle);
        const secret = await id.removeTotp(secretId);
        output(
          {
            id: secret.id,
            name: secret.name,
            secretType: secret.secretType,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("totp-code <handle> <secret-id>")
    .description("Generate a TOTP code (requires vault key)")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        secretId: string,
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        await inkbox.ready();
        const id = await inkbox.getIdentity(handle);
        const totp = await id.getTotpCode(secretId);
        output(
          {
            code: totp.code,
            periodStart: totp.periodStart,
            periodEnd: totp.periodEnd,
            secondsRemaining: totp.secondsRemaining,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("release-phone <handle>")
    .description("Release the identity's phone number back to the carrier (permanent)")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        await id.releasePhoneNumber();
        console.log(`Released phone number from identity '${handle}'.`);
      }),
    );

  registerIdentityAccessCommands(identity);
  registerIdentityMailRuleCommands(identity);
  registerIdentityPhoneRuleCommands(identity);
  registerIdentitySigningKeyCommands(identity);
}
