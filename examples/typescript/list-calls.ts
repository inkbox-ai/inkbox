import { Inkbox } from "@inkbox/sdk";

// --- Configuration ---
const limit = 10;
const offset = 0;
// ---------------------

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);

const calls = await identity.listCalls({ limit, offset });

console.log(JSON.stringify(calls, null, 2));
