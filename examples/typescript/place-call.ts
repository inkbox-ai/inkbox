import { Inkbox } from "@inkbox/sdk";

// --- Configuration ---
const toNumber = "+15551234567";
const clientWebsocketUrl = "";   // optional: set to stream audio in real time
// ---------------------

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);

const call = await identity.placeCall({
  toNumber,
  ...(clientWebsocketUrl ? { clientWebsocketUrl } : {}),
});

console.log(JSON.stringify(call, null, 2));
