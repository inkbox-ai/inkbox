/**
 * Agent self-signup example — register, verify, check status, send welcome email.
 *
 * Requires no pre-existing API key for registration. After the human approves
 * with the 6-digit code, verify and optionally send a welcome email.
 *
 * Environment variables (see .env.example):
 *   INKBOX_HUMAN_EMAIL        — human who receives the verification email (register)
 *   INKBOX_NOTE_TO_HUMAN      — message included in the verification email (register)
 *   INKBOX_AGENT_HANDLE       — optional base handle; a unique suffix is appended
 *   INKBOX_API_KEY            — one-time key returned by register (all other steps)
 *   INKBOX_AGENT_HANDLE_SAVED — handle returned by register (send-welcome, cleanup)
 */

import { randomUUID } from "node:crypto";
import { Inkbox } from "@inkbox/sdk";
import type { AgentSignupStatusResponse } from "@inkbox/sdk";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`ERROR: ${name} is required.`);
    process.exit(1);
  }
  return value;
}

function requireApiKey(): string {
  return requireEnv("INKBOX_API_KEY");
}

function printStatus(status: AgentSignupStatusResponse): void {
  console.log(`  claim_status:         ${status.claimStatus}`);
  console.log(`  human_state:          ${status.humanState}`);
  console.log(`  human_email:          ${status.humanEmail}`);
  console.log(`  max_sends_per_day:    ${status.restrictions.maxSendsPerDay}`);
  console.log(
    `  allowed_recipients:   ${status.restrictions.allowedRecipients.join(", ") || "-"}`,
  );
  console.log(`  can_receive:          ${status.restrictions.canReceive}`);
  console.log(
    `  can_create_mailboxes: ${status.restrictions.canCreateMailboxes}`,
  );
}

async function cmdRegister(): Promise<void> {
  const humanEmail = requireEnv("INKBOX_HUMAN_EMAIL");
  const note =
    process.env.INKBOX_NOTE_TO_HUMAN?.trim() ??
    "Hey! This is my agent signing up via the Inkbox signup example.";
  const baseHandle = process.env.INKBOX_AGENT_HANDLE?.trim() ?? "signup-demo";
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  const agentHandle = `${baseHandle}-${suffix}`;

  const result = await Inkbox.signup({
    humanEmail,
    noteToHuman: note,
    displayName: "Signup Demo Agent",
    agentHandle,
    emailLocalPart: agentHandle,
    harness: "cursor",
  });

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
  console.log();
  console.log("Next steps:");
  console.log("  1. Add INKBOX_API_KEY to your .env");
  console.log(`  2. Add INKBOX_AGENT_HANDLE_SAVED=${result.agentHandle} to your .env`);
  console.log("  3. Run: agent-signup.ts status");
  console.log("  4. After the human shares the code: agent-signup.ts verify --code <code>");
}

async function cmdStatus(): Promise<void> {
  const apiKey = requireApiKey();
  const status = await Inkbox.getSignupStatus(apiKey);
  console.log("Signup status:");
  printStatus(status);
}

async function cmdVerify(codeArg?: string): Promise<void> {
  const apiKey = requireApiKey();
  const code = codeArg?.trim() ?? process.env.INKBOX_VERIFICATION_CODE?.trim();
  if (!code) {
    console.error("ERROR: Pass --code or set INKBOX_VERIFICATION_CODE.");
    process.exit(1);
  }

  const result = await Inkbox.verifySignup(apiKey, { verificationCode: code });
  console.log();
  console.log("Verification successful!");
  console.log(`  claim_status: ${result.claimStatus}`);
  console.log(`  org:          ${result.organizationId}`);
  console.log(`  message:      ${result.message}`);
  console.log();
  console.log("Next: agent-signup.ts send-welcome");
}

async function cmdResend(): Promise<void> {
  const apiKey = requireApiKey();
  const result = await Inkbox.resendSignupVerification(apiKey);
  console.log();
  console.log("Verification email resent.");
  console.log(`  claim_status: ${result.claimStatus}`);
  console.log(`  org:          ${result.organizationId}`);
  console.log(`  message:      ${result.message}`);
}

async function cmdSendWelcome(): Promise<void> {
  const apiKey = requireApiKey();
  const handle = requireEnv("INKBOX_AGENT_HANDLE_SAVED");

  const inkbox = new Inkbox({ apiKey });
  const identity = await inkbox.getIdentity(handle);
  const status = await Inkbox.getSignupStatus(apiKey);
  await identity.sendEmail({
    to: [status.humanEmail],
    subject: "Hello from your agent!",
    bodyText:
      `Hi! I'm ${identity.agentHandle} (${identity.emailAddress}). ` +
      "I'm all set up after verification.",
  });
  console.log(`Sent welcome email to ${status.humanEmail}`);
  console.log(`  from: ${identity.emailAddress}`);
}

async function cmdCleanup(): Promise<void> {
  const apiKey = requireApiKey();
  const handle = requireEnv("INKBOX_AGENT_HANDLE_SAVED");

  const inkbox = new Inkbox({ apiKey });
  const identity = await inkbox.getIdentity(handle);
  await identity.delete();
  console.log(`Deleted identity: ${handle}`);
}

const [, , command, ...rest] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case "register":
      await cmdRegister();
      break;
    case "status":
      await cmdStatus();
      break;
    case "verify": {
      const codeIdx = rest.indexOf("--code");
      const code = codeIdx >= 0 ? rest[codeIdx + 1] : undefined;
      await cmdVerify(code);
      break;
    }
    case "resend":
      await cmdResend();
      break;
    case "send-welcome":
      await cmdSendWelcome();
      break;
    case "cleanup":
      await cmdCleanup();
      break;
    default:
      console.error(
        "Usage: agent-signup.ts <register|status|verify|resend|send-welcome|cleanup> [--code <code>]",
      );
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
