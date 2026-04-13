import { Command } from "commander";
import { getGlobalOpts, type GlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import { Inkbox } from "@inkbox/sdk";

function requireApiKey(opts: GlobalOpts): string {
  const apiKey = opts.apiKey ?? process.env.INKBOX_API_KEY;
  if (!apiKey) {
    console.error(
      "Error: API key required. Set INKBOX_API_KEY or pass --api-key.",
    );
    process.exit(1);
  }
  return apiKey;
}

export function registerSignupCommands(program: Command): void {
  const signup = program
    .command("signup")
    .description("Agent self-signup flow");

  signup
    .command("create")
    .description("Register a new agent (no API key required)")
    .requiredOption("--human-email <email>", "Email of the human who should approve this agent")
    .requiredOption("--note-to-human <note>", "Message from the agent to the human, included in the verification email")
    .option("--display-name <name>", "Human-readable name for the agent")
    .option("--agent-handle <handle>", "Requested handle for the agent identity")
    .option("--email-local-part <local>", "Requested mailbox local part before the sending domain")
    .action(
      withErrorHandler(async function (this: Command) {
        const globalOpts = getGlobalOpts(this);
        const cmdOpts = this.opts();
        const result = await Inkbox.signup(
          {
            humanEmail: cmdOpts.humanEmail,
            noteToHuman: cmdOpts.noteToHuman,
            displayName: cmdOpts.displayName,
            agentHandle: cmdOpts.agentHandle,
            emailLocalPart: cmdOpts.emailLocalPart,
          },
          { baseUrl: globalOpts.baseUrl },
        );
        if (globalOpts.json) {
          output(result, { json: true });
        } else {
          console.log();
          console.log("Agent registered successfully!");
          console.log();
          console.log(`  Email:    ${result.emailAddress}`);
          console.log(`  Handle:   ${result.agentHandle}`);
          console.log(`  Org:      ${result.organizationId}`);
          console.log(`  Status:   ${result.claimStatus}`);
          console.log();
          console.log(`  API Key:  ${result.apiKey}`);
          console.log();
          console.log("Save the API key — it is shown only once.");
          console.log(`A verification email has been sent to ${result.humanEmail}.`);
        }
      }),
    );

  signup
    .command("verify")
    .description("Submit a 6-digit verification code")
    .requiredOption("--code <code>", "The 6-digit verification code")
    .action(
      withErrorHandler(async function (this: Command) {
        const globalOpts = getGlobalOpts(this);
        const apiKey = requireApiKey(globalOpts);
        const cmdOpts = this.opts();
        const result = await Inkbox.verifySignup(
          apiKey,
          { verificationCode: cmdOpts.code },
          { baseUrl: globalOpts.baseUrl },
        );
        output(result, { json: !!globalOpts.json });
      }),
    );

  signup
    .command("resend-verification")
    .description("Resend the verification email (5-minute cooldown)")
    .action(
      withErrorHandler(async function (this: Command) {
        const globalOpts = getGlobalOpts(this);
        const apiKey = requireApiKey(globalOpts);
        const result = await Inkbox.resendSignupVerification(
          apiKey,
          { baseUrl: globalOpts.baseUrl },
        );
        output(result, { json: !!globalOpts.json });
      }),
    );

  signup
    .command("status")
    .description("Check signup claim status and restrictions")
    .action(
      withErrorHandler(async function (this: Command) {
        const globalOpts = getGlobalOpts(this);
        const apiKey = requireApiKey(globalOpts);
        const result = await Inkbox.getSignupStatus(
          apiKey,
          { baseUrl: globalOpts.baseUrl },
        );
        if (globalOpts.json) {
          output(result, { json: true });
        } else {
          output(
            {
              claimStatus: result.claimStatus,
              humanState: result.humanState,
              humanEmail: result.humanEmail,
              maxSendsPerDay: result.restrictions.maxSendsPerDay,
              allowedRecipients: result.restrictions.allowedRecipients.join(", ") || "-",
              canReceive: result.restrictions.canReceive,
              canCreateMailboxes: result.restrictions.canCreateMailboxes,
            },
            { json: false },
          );
        }
      }),
    );
}
