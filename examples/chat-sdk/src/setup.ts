import { open, unlink } from "node:fs/promises";
import { Inkbox } from "@inkbox/sdk";
import { INKBOX_CHAT_EVENTS } from "@inkbox/chat-sdk-adapter";
import { required } from "./env.js";

const client = new Inkbox({ apiKey: required("INKBOX_API_KEY") });
const identity = await client.getIdentity(required("INKBOX_AGENT_HANDLE"));
const url = new URL(required("INKBOX_WEBHOOK_URL"));
if (url.protocol !== "https:") throw new Error("INKBOX_WEBHOOK_URL must use HTTPS.");

const eventTypes = [...INKBOX_CHAT_EVENTS];
const subscriptions = await client.webhooks.subscriptions.list({
  agentIdentityId: identity.id,
  url: url.href,
  scope: "identity",
});
if (subscriptions.length) {
  const existing = subscriptions.find((subscription) =>
    eventTypes.every((event) => subscription.eventTypes.includes(event)),
  );
  if (existing) {
    console.info("The webhook subscription already exists. No changes made.");
  } else {
    // Upgrade only the exact previous setup default. Leave custom subscriptions alone.
    const previous = eventTypes.filter((event) => event !== "message.transcription_finished");
    const defaults = subscriptions.filter((subscription) =>
      subscription.eventTypes.length === previous.length &&
      previous.every((event) => subscription.eventTypes.includes(event)),
    );
    if (defaults.length !== 1) {
      throw new Error("An existing subscription needs additional events. Update it explicitly before rerunning setup.");
    }
    await client.webhooks.subscriptions.update(defaults[0].id, { scope: "identity", eventTypes });
    console.info("Added voice-note completions to the existing webhook subscription.");
  }
} else {
  if (identity.signingKeyConfigured && !process.env.INKBOX_SIGNING_SECRET) {
    throw new Error("Supply the existing INKBOX_SIGNING_SECRET. Setup will not rotate an identity signing key.");
  }
  // Reserve the output path before creating a one-time secret. Never overwrite a file.
  const secretFile = required("INKBOX_SIGNING_SECRET_FILE");
  const output = await open(secretFile, "wx", 0o600);
  let subscription;
  try {
    subscription = await client.webhooks.subscriptions.create({
      agentIdentityId: identity.id,
      url: url.href,
      eventTypes,
    });
    if (subscription.signingKey) {
      await output.writeFile(`${subscription.signingKey}\n`);
      await output.sync();
    }
  } finally {
    await output.close();
  }
  if (subscription.signingKey) {
    console.info("Created subscription. Load the saved signing secret into INKBOX_SIGNING_SECRET using your secret manager.");
  } else if (!process.env.INKBOX_SIGNING_SECRET) {
    await unlink(secretFile);
    throw new Error("An identity signing key already exists. Supply its existing secret before starting the receiver.");
  } else {
    await unlink(secretFile);
    console.info("Created subscription using the identity's existing signing key.");
  }
}
