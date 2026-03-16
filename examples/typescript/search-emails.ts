import { Inkbox } from "@inkbox/sdk";

// --- Configuration ---
const query = "invoice";
const limit = 10;
// ---------------------

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);

const mailbox = identity.mailbox;
if (!mailbox) {
  console.error("No mailbox linked to this identity");
  process.exit(1);
}

const results = await inkbox.mailboxes.search(mailbox.emailAddress, { q: query, limit });

console.log(JSON.stringify(results, null, 2));
