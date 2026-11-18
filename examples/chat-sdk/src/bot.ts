import { Chat, type Message, type Thread, type WebhookOptions } from "chat";
import { createRedisState } from "@chat-adapter/state-redis";
import {
  createInkboxAdapter,
  type InkboxMessage,
} from "@inkbox/chat-sdk-adapter";
import { required } from "./env.js";

export const inkbox = createInkboxAdapter({
  apiKey: () => required("INKBOX_API_KEY"),
  agentHandle: required("INKBOX_AGENT_HANDLE"),
  signingSecret: required("INKBOX_SIGNING_SECRET"),
  onMessage: (message) =>
    !(message.route.channel === "slack" && message.isBot === true),
});

export const bot = new Chat({
  userName: "inkbox-assistant",
  adapters: { inkbox },
  concurrency: "queue",
  state: createRedisState({
    url: required("REDIS_URL"),
    keyPrefix: `inkbox-example:${required("INKBOX_AGENT_HANDLE")}`,
  }),
});

async function handleMessage(thread: Thread, message: Message) {
  await thread.subscribe();
  const route = (message.raw as InkboxMessage).route;
  if (route.channel === "voice") {
    // No unambiguous messaging destination was resolved for this call.
    await thread.setState({ lastCall: { id: message.id, text: message.text } });
    return;
  }
  await inkbox.send(
    thread.id,
    "Thanks! Your message reached the Inkbox Chat SDK example.",
    {
      idempotencyKey: `reply:${message.id}`,
      ...(route.channel === "email" ? { replyToMessageId: message.id } : {}),
      ...(route.channel === "a2a" ? { a2aTaskId: route.taskId } : {}),
    },
  );
}

async function receive(thread: Thread, message: Message) {
  try {
    await handleMessage(thread, message);
  } catch (error) {
    console.error(
      "Inkbox message processing failed. Recover the application operation explicitly.",
    );
    throw error;
  }
}

bot.onNewMention(receive);
bot.onSubscribedMessage(receive);

// Forward your host's request-scoped waitUntil when background execution is supported.
export function handleWebhook(
  request: Request,
  options?: WebhookOptions,
): Promise<Response> {
  return bot.webhooks.inkbox(request, options);
}

// Mount this Fetch API handler at POST /webhooks/inkbox in your web framework.
// Without waitUntil, the request stays open until processing finishes.
export function POST(request: Request): Promise<Response> {
  return handleWebhook(request);
}
