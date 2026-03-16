import { Inkbox } from "@inkbox/sdk";

// --- Configuration ---
const to = ["recipient@example.com"];
const subject = "Hello from Inkbox";
const bodyText = "Hi there! This is a test email sent via the Inkbox SDK.";
const cc: string[] = [];         // optional
const bcc: string[] = [];        // optional
const inReplyToMessageId = "";   // optional: set to reply to an existing message
// ---------------------

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);

const message = await identity.sendEmail({
  to,
  subject,
  bodyText,
  ...(cc.length ? { cc } : {}),
  ...(bcc.length ? { bcc } : {}),
  ...(inReplyToMessageId ? { inReplyToMessageId } : {}),
});

console.log(JSON.stringify(message, null, 2));
