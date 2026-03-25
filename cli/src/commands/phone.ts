import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

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
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { identity: string; to: string; wsUrl?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const call = await identity.placeCall({
          toNumber: cmdOpts.to,
          clientWebsocketUrl: cmdOpts.wsUrl,
        });
        output(
          {
            id: call.id,
            from: call.localPhoneNumber,
            to: call.remotePhoneNumber,
            status: call.status,
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
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { identity: string; limit: string; offset: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const calls = await identity.listCalls({
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
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
}
