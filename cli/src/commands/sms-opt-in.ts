import { Command } from "commander";
import { SmsOptInStatus } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerSmsOptInCommands(program: Command): void {
  const optIn = program
    .command("sms-opt-in")
    .description(
      "SMS opt-in / opt-out registry (per-recipient consent state). " +
        "Writes require your org to be on its own active, customer-managed 10DLC campaign.",
    );

  optIn
    .command("list")
    .description("List your org's consent rows, newest-updated first")
    .option(
      "--status <state>",
      "Filter by 'opted_in' or 'opted_out' (omit for both)",
    )
    .option("--limit <n>", "Max rows to return (1-200)", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { status?: string; limit: string; offset: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rows = await inkbox.smsOptIns.list({
          status: cmdOpts.status as SmsOptInStatus | undefined,
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
        });
        output(rows, {
          json: !!opts.json,
          columns: [
            "receiverNumber",
            "status",
            "source",
            "optedInAt",
            "optedOutAt",
            "updatedAt",
          ],
        });
      }),
    );

  optIn
    .command("get <receiver-number>")
    .description("Look up the consent state for one recipient (E.164)")
    .action(
      withErrorHandler(async function (
        this: Command,
        receiverNumber: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const row = await inkbox.smsOptIns.get(receiverNumber);
        output(row, { json: !!opts.json });
      }),
    );

  optIn
    .command("opt-in <receiver-number>")
    .description(
      "Mark a recipient as opted in (requires active, customer-managed 10DLC campaign)",
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        receiverNumber: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const row = await inkbox.smsOptIns.optIn(receiverNumber);
        output(row, { json: !!opts.json });
      }),
    );

  optIn
    .command("opt-out <receiver-number>")
    .description(
      "Mark a recipient as opted out (requires active, customer-managed 10DLC campaign)",
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        receiverNumber: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const row = await inkbox.smsOptIns.optOut(receiverNumber);
        output(row, { json: !!opts.json });
      }),
    );
}
