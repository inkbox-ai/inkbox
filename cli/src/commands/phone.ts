import { Command } from "commander";
import { CallMode, IncomingCallAction } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

interface PlaceCallCommandOptions {
  identity: string;
  to: string;
  wsUrl?: string;
  hosted?: boolean;
  reason?: string;
}

interface PlaceCallOptions {
  toNumber: string;
  clientWebsocketUrl?: string;
  mode?: CallMode;
  reason?: string;
}

export function buildPlaceCallOptions(
  cmdOpts: PlaceCallCommandOptions,
): { callOptions: PlaceCallOptions } | { error: string } {
  // Shape-only gating; everything else (reason length, capacity, quotas)
  // is the server's call and surfaces as an API error.
  if (cmdOpts.hosted && !cmdOpts.reason) {
    return { error: "--hosted requires --reason (the agent's task brief)." };
  }
  if (cmdOpts.hosted && cmdOpts.wsUrl) {
    return { error: "--hosted conflicts with --ws-url (Voice AI calls need no socket)." };
  }
  if (!cmdOpts.hosted && cmdOpts.reason) {
    return { error: "--reason is only valid with --hosted." };
  }

  const callOptions: PlaceCallOptions = { toNumber: cmdOpts.to };
  if (cmdOpts.wsUrl) {
    callOptions.clientWebsocketUrl = cmdOpts.wsUrl;
  }
  if (cmdOpts.hosted) {
    callOptions.mode = CallMode.HOSTED_AGENT;
    callOptions.reason = cmdOpts.reason;
  }
  return { callOptions };
}

export function registerPhoneCommands(program: Command): void {
  const phone = program
    .command("phone")
    .description("Phone operations (identity-scoped)");

  phone
    .command("call")
    .description("Place an outbound call")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("--to <number>", "E.164 destination number")
    .option("--ws-url <url>", "WebSocket URL (wss://) for audio bridging")
    .option("--hosted", "Let Inkbox Voice AI drive the call (requires --reason)")
    .option("--reason <text>", "Voice AI's task brief — what to accomplish")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: PlaceCallCommandOptions,
      ) {
        const built = buildPlaceCallOptions(cmdOpts);
        if ("error" in built) {
          console.error(built.error);
          process.exit(1);
        }

        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const call = await identity.placeCall(built.callOptions);
        output(
          {
            id: call.id,
            from: call.localPhoneNumber,
            to: call.remotePhoneNumber,
            status: call.status,
            mode: call.mode,
            reason: call.reason,
            callsRemaining: call.rateLimit.callsRemaining,
          },
          { json: !!opts.json },
        );
      }),
    );

  phone
    .command("calls")
    .description("List calls")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--limit <n>", "Max results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .option("--start-datetime <date>", "Only calls with created_at >= this date/instant")
    .option("--end-datetime <date>", "Only calls with created_at <= this date (bare date is whole-day inclusive)")
    .option("--tz <zone>", "IANA timezone for bare/zone-less dates (default UTC)")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          limit: string;
          offset: string;
          startDatetime?: string;
          endDatetime?: string;
          tz?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const calls = await identity.listCalls({
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
          startDatetime: cmdOpts.startDatetime,
          endDatetime: cmdOpts.endDatetime,
          tz: cmdOpts.tz,
        });
        output(calls, {
          json: !!opts.json,
          columns: [
            "id",
            "direction",
            "remotePhoneNumber",
            "status",
            "createdAt",
          ],
        });
      }),
    );

  phone
    .command("transcripts <call-id>")
    .description("Get call transcripts")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        callId: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const transcripts = await identity.listTranscripts(callId);
        output(transcripts, {
          json: !!opts.json,
          columns: ["seq", "party", "text", "createdAt"],
        });
      }),
    );

  phone
    .command("hangup <call-id>")
    .description("Hang up a live call")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        callId: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const call = await identity.hangupCall(callId);
        output(
          {
            id: call.id,
            // Hangup applies to inbound calls too, so label the peer as the
            // remote party (with direction) rather than a destination "to".
            direction: call.direction,
            remotePhoneNumber: call.remotePhoneNumber,
            status: call.status,
            hangupReason: call.hangupReason,
          },
          { json: !!opts.json },
        );
      }),
    );

  phone
    .command("search-transcripts")
    .description("Search call transcripts")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("-q, --query <query>", "Search query")
    .option("--party <party>", "Filter by speaker: local or remote")
    .option("--limit <n>", "Max results", "50")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          query: string;
          party?: string;
          limit: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        if (!identity.phoneNumber) {
          console.error(
            `Identity '${cmdOpts.identity}' has no phone number assigned.`,
          );
          process.exit(1);
        }
        const transcripts = await inkbox.phoneNumbers.searchTranscripts(
          identity.phoneNumber.id,
          {
            q: cmdOpts.query,
            party: cmdOpts.party,
            limit: parseInt(cmdOpts.limit, 10),
          },
        );
        output(transcripts, {
          json: !!opts.json,
          columns: ["id", "callId", "seq", "party", "text", "createdAt"],
        });
      }),
    );

  phone
    .command("incoming-action [action]")
    .description(
      "Get, or set to auto_accept | auto_reject | webhook | hosted_agent, " +
        "this identity's incoming-call action (hosted_agent needs no URL)",
    )
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--ws-url <url>", "WebSocket URL (wss://) for audio bridging")
    .option("--webhook-url <url>", "HTTPS receiver for the webhook action")
    .action(
      withErrorHandler(async function (
        this: Command,
        action: string | undefined,
        cmdOpts: { identity: string; wsUrl?: string; webhookUrl?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        // Without an action, print the current config; with one, set it.
        // The action string is forwarded verbatim — the server rejects
        // unknown values.
        const config = action
          ? await identity.setIncomingCallAction({
              incomingCallAction: action as IncomingCallAction,
              clientWebsocketUrl: cmdOpts.wsUrl,
              incomingCallWebhookUrl: cmdOpts.webhookUrl,
            })
          : await identity.getIncomingCallAction();
        output(
          {
            agentIdentityId: config.agentIdentityId,
            incomingCallAction: config.incomingCallAction,
            clientWebsocketUrl: config.clientWebsocketUrl,
            incomingCallWebhookUrl: config.incomingCallWebhookUrl,
          },
          { json: !!opts.json },
        );
      }),
    );

  const hostedAgent = phone
    .command("hosted-agent")
    .description("Inkbox Voice AI config (identity-scoped)");

  hostedAgent
    .command("get")
    .description("Show this identity's Inkbox Voice AI config")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const config = await identity.getHostedAgentConfig();
        output(
          {
            agentIdentityId: config.agentIdentityId,
            voice: config.voice,
            model: config.model,
            instructions: config.instructions,
          },
          { json: !!opts.json },
        );
      }),
    );

  hostedAgent
    .command("set")
    .description(
      "Set this identity's Inkbox Voice AI config. Full replace: an " +
        "omitted flag resets that field to the server default",
    )
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--voice <voice>", "Voice override")
    .option("--model <model>", "Model override")
    .option("--instructions <text>", "Per-identity steering prompt")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          voice?: string;
          model?: string;
          instructions?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const config = await identity.setHostedAgentConfig({
          voice: cmdOpts.voice,
          model: cmdOpts.model,
          instructions: cmdOpts.instructions,
        });
        output(
          {
            agentIdentityId: config.agentIdentityId,
            voice: config.voice,
            model: config.model,
            instructions: config.instructions,
          },
          { json: !!opts.json },
        );
      }),
    );
}
