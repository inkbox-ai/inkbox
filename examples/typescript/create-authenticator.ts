import { Inkbox } from "@inkbox/sdk";

// --- Configuration ---
const otpauthUri = "otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example";
const displayName = "My OTP Account";  // optional
// ---------------------

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);

// Create an authenticator app and link it to the identity
const app = await identity.createAuthenticatorApp();
console.log("Authenticator app created:", app.id);

// Add an OTP account from an otpauth:// URI
const account = await identity.createAuthenticatorAccount({
  otpauthUri,
  displayName,
});
console.log("Account created:", JSON.stringify(account, null, 2));
