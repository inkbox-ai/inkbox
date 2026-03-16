import { Inkbox } from "@inkbox/sdk";

// --- Configuration ---
const limit = 10;
const unreadOnly = false;
// ---------------------

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);

const messages = [];
const iter = unreadOnly ? identity.iterUnreadEmails() : identity.iterEmails();

for await (const msg of iter) {
  messages.push(msg);
  if (messages.length >= limit) break;
}

console.log(JSON.stringify(messages, null, 2));
