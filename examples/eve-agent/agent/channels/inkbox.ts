import { createInkboxAdapter } from "@inkbox/chat-sdk-adapter";
import { createRedisState } from "@chat-adapter/state-redis";
import type { Message, Thread } from "chat";
import { chatSdkChannel, messageContentOf } from "eve/channels/chat-sdk";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before starting the agent.`);
  return value;
}

const inkbox = createInkboxAdapter({
  apiKey: () => required("INKBOX_API_KEY"),
  agentHandle: required("INKBOX_AGENT_HANDLE"),
  signingSecret: required("INKBOX_SIGNING_SECRET"),
  defaultA2AIntent: "complete",
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
});

async function handleMessage(thread: Thread, message: Message) {
  await thread.subscribe();
  if (inkbox.decodeThreadId(thread.id).channel === "voice") {
    await thread.setState({ lastCall: { id: message.id, text: message.text } });
    return;
  }
  await send(messageContentOf(message), {
    thread,
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
