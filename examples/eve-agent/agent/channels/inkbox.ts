import { createInkboxAdapter } from "@inkbox/chat-sdk-adapter";
import { createRedisState } from "@chat-adapter/state-redis";
import type { Message, Thread } from "chat";
import { chatSdkChannel, messageContentOf } from "eve/channels/chat-sdk";
import { a2aInputAuth, inkboxChannelEvents, INKBOX_EVE_A2A_INTENT } from "../lib/inkbox-events.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before starting the agent.`);
  return value;
}

const inkbox = createInkboxAdapter({
  apiKey: () => required("INKBOX_API_KEY"),
  agentHandle: required("INKBOX_AGENT_HANDLE"),
  signingSecret: required("INKBOX_SIGNING_SECRET"),
  onMessage: (message) => !(message.route.channel === "slack" && message.isBot === true),
  defaultA2AIntent: INKBOX_EVE_A2A_INTENT,
});

export const { bot, channel, send } = chatSdkChannel({
  userName: "inkbox-assistant",
  adapters: { inkbox },
  state: createRedisState({
    url: required("REDIS_URL"),
    keyPrefix: `inkbox-eve:${required("INKBOX_AGENT_HANDLE")}`,
  }),
  concurrency: "concurrent",
  streaming: false,
  events: inkboxChannelEvents(inkbox),
});

async function handleMessage(thread: Thread, message: Message) {
  await thread.subscribe();
  if (inkbox.decodeThreadId(thread.id).channel === "voice") {
    await thread.setState({ lastCall: { id: message.id, text: message.text } });
    return;
  }
  const route = (message.raw as { route?: { channel?: string; taskId?: string } }).route;
  if (route?.channel === "a2a" && !route.taskId) throw new Error("An A2A input requires a task ID.");
  await send(messageContentOf(message), {
    thread,
    ...(route?.channel === "a2a" ? { auth: a2aInputAuth(thread.id, route.taskId!), turnPolicy: "queue" as const } : {}),
    idempotencyKey: `${thread.id}:${message.id}`,
  });
}

async function receive(thread: Thread, message: Message) {
  try {
    await handleMessage(thread, message);
  } catch (error) {
    console.error("Inkbox input could not be handed to Eve. Recover the application operation explicitly.");
    throw error;
  }
}

bot.onNewMention(receive);
bot.onSubscribedMessage(receive);


export default channel;
