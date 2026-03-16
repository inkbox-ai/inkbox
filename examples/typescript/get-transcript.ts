import { Inkbox } from "@inkbox/sdk";

// --- Configuration ---
const callId = "your-call-id-here";
// ---------------------

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);

const transcript = await identity.listTranscripts(callId);

console.log(JSON.stringify(transcript, null, 2));
