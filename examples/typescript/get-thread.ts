import { Inkbox } from "@inkbox/sdk";

// --- Configuration ---
const threadId = "your-thread-id-here";
// ---------------------

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);

const thread = await identity.getThread(threadId);

console.log(JSON.stringify(thread, null, 2));
