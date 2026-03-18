import { Inkbox } from "@inkbox/sdk";

// --- Configuration ---
const accountId = "";  // UUID of the authenticator account
// ---------------------

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);

const otp = await identity.generateOtp(accountId);

console.log(`OTP code: ${otp.otpCode}`);
console.log(`Type: ${otp.otpType}`);
if (otp.validForSeconds !== null) {
  console.log(`Valid for: ${otp.validForSeconds}s`);
}
