import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);

const accounts = await identity.listAuthenticatorAccounts();

console.log(JSON.stringify(accounts, null, 2));
