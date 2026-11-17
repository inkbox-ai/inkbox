import { Chat, type Message, type Thread, type WebhookOptions } from "chat";
import { createRedisState } from "@chat-adapter/state-redis";
import { createInkboxAdapter } from "@inkbox/chat-sdk-adapter";
import { required } from "./env.js";

export const inkbox = createInkboxAdapter({
  apiKey: () => required("INKBOX_API_KEY"),
  agentHandle: required("INKBOX_AGENT_HANDLE"),
  signingSecret: required("INKBOX_SIGNING_SECRET"),
});

export const bot = new Chat({
  userName: "inkbox-assistant",
  adapters: { inkbox },
  state: createRedisState({
    url: required("REDIS_URL"),
    keyPrefix: `inkbox-example:${required("INKBOX_AGENT_HANDLE")}`,
  }),
});

async function handleMessage(thread: Thread, message: Message) {
  await thread.subscribe();
  if (inkbox.decodeThreadId(thread.id).channel === "voice") {
    // A completed call cannot receive a chat reply. Save its transcript for follow-up.
    await thread.setState({ lastCall: { id: message.id, text: message.text } });
    return;
  }
  await thread.post("Thanks! Your message reached the Inkbox Chat SDK example.");
}

async function receive(thread: Thread, message: Message) {
  try {
    await handleMessage(thread, message);
  } catch (error) {
    console.error("Inkbox message processing failed. Recover the application operation explicitly.");
    throw error;
  }
}

bot.onNewMention(receive);
bot.onSubscribedMessage(receive);
bot.onNewMessage(receive);

// Forward your host's request-scoped waitUntil when background execution is supported.
export function handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
  return bot.webhooks.inkbox(request, options);
}

// Mount this Fetch API handler at POST /webhooks/inkbox in your web framework.
// Without waitUntil, the request stays open until processing finishes.
export function POST(request: Request): Promise<Response> {
  return handleWebhook(request);
}
