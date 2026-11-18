import type { InkboxAdapter } from "@inkbox/chat-sdk-adapter";
import type { ChatSdkChannelEvents } from "eve/channels/chat-sdk";

// Unoverridden bridge posts are interaction prompts, not final task answers.
export const INKBOX_EVE_A2A_INTENT = "ask_caller" as const;

export function inkboxChannelEvents(
  inkbox: Pick<InkboxAdapter, "decodeThreadId" | "send">,
): ChatSdkChannelEvents {
  return {
    async "content.completed"({ data }, { channel, session }) {
      if (data.kind !== "text" || data.phase !== "reply" || typeof data.value !== "string" || !data.value) return;
      const thread = channel.thread;
      if (!thread) return;
      if (inkbox.decodeThreadId(thread.id).channel === "a2a") {
        channel.state[`inkbox:reply:${session.turn.id}:${data.partId}`] = data.value;
        return;
      }
      await inkbox.send(thread.id, { markdown: data.value }, {
        idempotencyKey: `eve-reply:${session.turn.id}:${data.partId}`,
        ...(inkbox.decodeThreadId(thread.id).channel === "email"
          ? { replyToMessageId: thread.toJSON().currentMessage?.id } : {}),
      });
    },
    async "turn.settled"({ data }, { channel }) {
      const thread = channel.thread;
      if (!thread) return;
      const isA2A = inkbox.decodeThreadId(thread.id).channel === "a2a";
      if (!isA2A) {
        if (data.outcome === "failed") {
          await inkbox.send(thread.id, "I could not complete that request. Please try again.", {
            idempotencyKey: `eve-failure:${data.turnId}`,
            ...(inkbox.decodeThreadId(thread.id).channel === "email"
              ? { replyToMessageId: thread.toJSON().currentMessage?.id } : {}),
          });
        }
        return;
      }
      if (channel.state.inkboxA2ATerminal === true) return;
      const prefix = `inkbox:reply:${data.turnId}:`;
      const keys = Object.keys(channel.state).filter(key => key.startsWith(prefix));
      if (data.outcome === "cancelled") {
        for (const key of keys) delete channel.state[key];
        return;
      }
      const replyKeys = data.reply ? data.reply.map(partId => `${prefix}${partId}`) : keys;
      const text = replyKeys.map(key => channel.state[key]).filter((value): value is string => typeof value === "string").join("\n\n");
      const completed = data.outcome === "completed" && text.length > 0;
      await inkbox.send(thread.id,
        completed ? text : "The agent could not complete this task.",
        { a2aIntent: completed ? "complete" : "fail", idempotencyKey: `eve-task:${data.turnId}` },
      );
      channel.state.inkboxA2ATerminal = true;
      for (const key of keys) delete channel.state[key];
    },
    async "session.ended"({ data }, { channel, session }) {
      if (data.outcome !== "failed" || !channel.thread) return;
      const isA2A = inkbox.decodeThreadId(channel.thread.id).channel === "a2a";
      if (isA2A && channel.state.inkboxA2ATerminal === true) return;
      await inkbox.send(channel.thread.id, "This session could not recover. Please start a new request.", {
        ...(isA2A ? { a2aIntent: "fail" as const } : {}),
        idempotencyKey: `eve-session-failure:${session.id}`,
        ...(inkbox.decodeThreadId(channel.thread.id).channel === "email"
          ? { replyToMessageId: channel.thread.toJSON().currentMessage?.id } : {}),
      });
      if (isA2A) channel.state.inkboxA2ATerminal = true;
    },
  };
}
