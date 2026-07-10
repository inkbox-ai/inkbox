import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import { verifyWebhook } from "@inkbox/sdk";
import type {
  WebhookSubscription,
  WebhookSubscriptionCreateResponse,
  WebhookDelivery,
  WebhookContextClassConfig,
  WebhookContextConfig,
} from "@inkbox/sdk";

const WEBHOOK_SUBSCRIPTION_LIST_COLUMNS = [
  "id",
  "mailboxId",
  "phoneNumberId",
  "agentIdentityId",
  "url",
  "eventTypes",
  "contextConfig",
  "status",
  "createdAt",
];

function flattenForOutput(sub: WebhookSubscription): Record<string, unknown> {
  return {
    id: sub.id,
    organizationId: sub.organizationId,
    mailboxId: sub.mailboxId,
    phoneNumberId: sub.phoneNumberId,
    agentIdentityId: sub.agentIdentityId,
    url: sub.url,
    eventTypes: sub.eventTypes.join(", "),
    contextConfig: sub.contextConfig ? JSON.stringify(sub.contextConfig) : null,
    status: sub.status,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
  };
}

// Create-only display shape: surfaces the one-time plaintext signingKey and the
// resolved ownerIdentityId, which flattenForOutput drops. signingKey is shown
// only on the first create that mints the owning identity's key.
export function flattenCreateForOutput(
  row: WebhookSubscriptionCreateResponse,
): Record<string, unknown> {
  return {
    ...flattenForOutput(row),
    ownerIdentityId: row.ownerIdentityId,
    signingKey: row.signingKey,
  };
}

// --json preserves the SDK response shape (eventTypes stays an array) so the
// one-time signingKey/ownerIdentityId survive; human output uses the flattened
// create shape. Either way the plaintext signingKey is never dropped.
export function buildCreateOutput(
  row: WebhookSubscriptionCreateResponse,
  json: boolean,
): { data: unknown; json: boolean } {
  return json
    ? { data: row, json: true }
    : { data: flattenCreateForOutput(row), json: false };
}

// `count:N` -> {mode:"count",count:N}; `window:H` -> {mode:"window",hours:H}.
// Bounds (1..50 / 1..168) are validated by the SDK so the limits live in one place.
export function parseContextSpec(value: string): WebhookContextClassConfig {
  const idx = value.indexOf(":");
  const mode = idx === -1 ? value : value.slice(0, idx);
  const rawNum = idx === -1 ? "" : value.slice(idx + 1);
  const n = /^\d+$/.test(rawNum) ? Number(rawNum) : NaN;
  if (mode === "count" && !Number.isNaN(n)) return { mode: "count", count: n };
  if (mode === "window" && !Number.isNaN(n)) return { mode: "window", hours: n };
  throw new Error(
    `Invalid context spec '${value}'. Use 'count:N' (e.g. count:10) or 'window:H' (e.g. window:24).`,
  );
}

// Assemble contextConfig from whichever --context-* flags were passed;
// undefined when none were (so create/update omit the field).
function buildContextConfigFromFlags(cmdOpts: {
  contextEmail?: string;
  contextTexts?: string;
  contextCalls?: string;
}): WebhookContextConfig | undefined {
  const cfg: WebhookContextConfig = {};
  if (cmdOpts.contextEmail !== undefined) cfg.email = parseContextSpec(cmdOpts.contextEmail);
  if (cmdOpts.contextTexts !== undefined) cfg.texts = parseContextSpec(cmdOpts.contextTexts);
  if (cmdOpts.contextCalls !== undefined) cfg.calls = parseContextSpec(cmdOpts.contextCalls);
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}

function registerSubscriptionCommands(parent: Command): void {
  const sub = parent
    .command("subscription")
    .description("Manage webhook subscriptions (fan-out per (owner, url, event_types))");

  sub
    .command("list")
    .description("List webhook subscriptions in the caller's org (filters AND-combine)")
    .option("--mailbox-id <id>", "Filter by owning mailbox id")
    .option("--phone-number-id <id>", "Filter by owning phone number id")
    .option("--agent-identity-id <id>", "Filter by owning agent identity id (iMessage)")
    .option("--url <url>", "Filter by destination URL (exact match)")
    .option("--event-type <type>", "Filter by event type wire value")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          mailboxId?: string;
          phoneNumberId?: string;
          agentIdentityId?: string;
          url?: string;
          eventType?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const subs = await inkbox.webhooks.subscriptions.list({
          mailboxId: cmdOpts.mailboxId,
          phoneNumberId: cmdOpts.phoneNumberId,
          agentIdentityId: cmdOpts.agentIdentityId,
          url: cmdOpts.url,
          eventType: cmdOpts.eventType,
        });
        output(subs.map(flattenForOutput), {
          json: !!opts.json,
          columns: WEBHOOK_SUBSCRIPTION_LIST_COLUMNS,
        });
      }),
    );

  sub
    .command("get <sub-id>")
    .description("Get a webhook subscription by id")
    .action(
      withErrorHandler(async function (this: Command, subId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const row = await inkbox.webhooks.subscriptions.get(subId);
        output(flattenForOutput(row), { json: !!opts.json });
      }),
    );

  sub
    .command("create")
    .description("Create a webhook subscription. Exactly one of --mailbox-id / --phone-number-id / --agent-identity-id is required.")
    .option("--mailbox-id <id>", "Owning mailbox id")
    .option("--phone-number-id <id>", "Owning phone number id")
    .option("--agent-identity-id <id>", "Owning agent identity id (for imessage.* or call.ended events)")
    .requiredOption("--url <url>", "HTTPS destination for delivered events")
    .requiredOption(
      "--event-type <type>",
      "Event type to subscribe (repeatable; at least one required)",
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .option("--context-email <spec>", "Include recent emails as context: count:N or window:H")
    .option("--context-texts <spec>", "Include recent SMS+iMessage as context: count:N or window:H")
    .option("--context-calls <spec>", "Include recent calls+transcripts as context: count:N or window:H")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          mailboxId?: string;
          phoneNumberId?: string;
          agentIdentityId?: string;
          url: string;
          eventType: string[];
          contextEmail?: string;
          contextTexts?: string;
          contextCalls?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const row = await inkbox.webhooks.subscriptions.create({
          mailboxId: cmdOpts.mailboxId,
          phoneNumberId: cmdOpts.phoneNumberId,
          agentIdentityId: cmdOpts.agentIdentityId,
          url: cmdOpts.url,
          eventTypes: cmdOpts.eventType,
          contextConfig: buildContextConfigFromFlags(cmdOpts),
        });
        const { data, json } = buildCreateOutput(row, !!opts.json);
        output(data, { json });
      }),
    );

  sub
    .command("update <sub-id>")
    .description("Update url and/or event_types on a subscription. --event-type replaces the stored list.")
    .option("--url <url>", "New HTTPS destination")
    .option(
      "--event-type <type>",
      "Event type to subscribe (repeatable; presence replaces stored list)",
      (val: string, acc: string[] | undefined) => {
        return acc === undefined ? [val] : [...acc, val];
      },
      // intentionally no default: undefined distinguishes "not provided"
      // from "explicitly empty" (the latter is invalid and the SDK throws).
    )
    .option("--context-email <spec>", "Set email context: count:N or window:H (replaces stored config)")
    .option("--context-texts <spec>", "Set texts context: count:N or window:H (replaces stored config)")
    .option("--context-calls <spec>", "Set calls context: count:N or window:H (replaces stored config)")
    .option("--clear-context", "Clear all conversation context (mutually exclusive with --context-*)")
    .action(
      withErrorHandler(async function (
        this: Command,
        subId: string,
        cmdOpts: {
          url?: string;
          eventType?: string[];
          contextEmail?: string;
          contextTexts?: string;
          contextCalls?: string;
          clearContext?: boolean;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const body: {
          url?: string;
          eventTypes?: string[];
          contextConfig?: WebhookContextConfig | null;
        } = {};
        if (cmdOpts.url !== undefined) body.url = cmdOpts.url;
        if (cmdOpts.eventType !== undefined) body.eventTypes = cmdOpts.eventType;
        const contextConfig = buildContextConfigFromFlags(cmdOpts);
        if (cmdOpts.clearContext && contextConfig !== undefined) {
          throw new Error(
            "--clear-context cannot be combined with --context-email/--context-texts/--context-calls.",
          );
        }
        if (cmdOpts.clearContext) {
          body.contextConfig = null;
        } else if (contextConfig !== undefined) {
          body.contextConfig = contextConfig;
        }
        const row = await inkbox.webhooks.subscriptions.update(subId, body);
        output(flattenForOutput(row), { json: !!opts.json });
      }),
    );

  sub
    .command("delete <sub-id>")
    .description("Remove a webhook subscription")
    .action(
      withErrorHandler(async function (this: Command, subId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.webhooks.subscriptions.delete(subId);
        console.log(`Deleted webhook subscription '${subId}'.`);
      }),
    );
}

const WEBHOOK_DELIVERY_LIST_COLUMNS = [
  "id",
  "eventType",
  "eventId",
  "url",
  "responseStatus",
  "isReplay",
  "createdAt",
];

function flattenDeliveryForOutput(d: WebhookDelivery): Record<string, unknown> {
  return {
    id: d.id,
    organizationId: d.organizationId,
    webhookSubscriptionId: d.webhookSubscriptionId,
    phoneNumberId: d.phoneNumberId,
    eventId: d.eventId,
    eventType: d.eventType,
    url: d.url,
    requestPayload: d.requestPayload,
    responseStatus: d.responseStatus,
    responseBody: d.responseBody,
    errorDetail: d.errorDetail,
    durationMs: d.durationMs,
    isReplay: d.isReplay,
    createdAt: d.createdAt,
  };
}

function registerDeliveryCommands(parent: Command): void {
  const delivery = parent
    .command("delivery")
    .description("Inspect the webhook delivery log and replay missed deliveries");

  delivery
    .command("list")
    .description("List logged webhook delivery attempts, newest first (filters AND-combine)")
    .option("--subscription-id <id>", "Filter by the targeted subscription id")
    .option("--phone-number-id <id>", "Filter by phone number id (incoming-call deliveries)")
    .option("--event-type <type>", "Filter by event type wire value")
    .option("--success", "Only deliveries with a 2xx response")
    .option("--failed", "Only deliveries that failed or got no response")
    .option("--limit <n>", "Page size (1-200, default 50)", (v) => parseInt(v, 10))
    .option("--offset <n>", "Row offset for pagination", (v) => parseInt(v, 10))
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          subscriptionId?: string;
          phoneNumberId?: string;
          eventType?: string;
          success?: boolean;
          failed?: boolean;
          limit?: number;
          offset?: number;
        },
      ) {
        if (cmdOpts.success && cmdOpts.failed) {
          throw new Error("Pass at most one of --success / --failed.");
        }
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const success = cmdOpts.success
          ? true
          : cmdOpts.failed
            ? false
            : undefined;
        const rows = await inkbox.webhooks.deliveries.list({
          subscriptionId: cmdOpts.subscriptionId,
          phoneNumberId: cmdOpts.phoneNumberId,
          eventType: cmdOpts.eventType,
          success,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        });
        output(rows.map(flattenDeliveryForOutput), {
          json: !!opts.json,
          columns: WEBHOOK_DELIVERY_LIST_COLUMNS,
        });
      }),
    );

  delivery
    .command("replay <delivery-id>")
    .description("Re-deliver a logged event to its subscription's current URL")
    .action(
      withErrorHandler(async function (this: Command, deliveryId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const row = await inkbox.webhooks.deliveries.replay(deliveryId);
        output(flattenDeliveryForOutput(row), { json: !!opts.json });
      }),
    );
}

export function registerWebhookCommands(program: Command): void {
  const webhook = program
    .command("webhook")
    .description("Webhook utilities");

  webhook
    .command("verify")
    .description("Verify a webhook signature (local, no API call)")
    .requiredOption("--payload <payload>", "Raw request body")
    .requiredOption("--secret <secret>", "Signing key secret")
    .option(
      "-H, --header <header>",
      "Header in Key: Value format (repeatable)",
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          payload: string;
          secret: string;
          header: string[];
        },
      ) {
        const opts = getGlobalOpts(this);
        const headers: Record<string, string> = {};
        for (const h of cmdOpts.header) {
          const idx = h.indexOf(":");
          if (idx === -1) {
            console.error(`Error: Invalid header format '${h}'. Use 'Key: Value'.`);
            process.exit(1);
          }
          headers[h.slice(0, idx).trim().toLowerCase()] = h
            .slice(idx + 1)
            .trim();
        }

        const valid = verifyWebhook({
          payload: cmdOpts.payload,
          headers,
          secret: cmdOpts.secret,
        });

        if (opts.json) {
          output({ valid }, { json: true });
        } else if (valid) {
          console.log("Valid signature.");
        } else {
          console.error("Invalid signature.");
          process.exit(1);
        }
      }),
    );

  registerSubscriptionCommands(webhook);
  registerDeliveryCommands(webhook);
}
