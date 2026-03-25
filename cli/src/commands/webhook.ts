import { Command } from "commander";
import { getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import { verifyWebhook } from "@inkbox/sdk";

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
}
