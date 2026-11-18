import type { InkboxAdapter } from "@inkbox/chat-sdk-adapter";
import type { ChatSdkChannelEvents, ChatSdkSendOptions } from "eve/channels/chat-sdk";
import { delivery, interaction, nextPrompt, type Principal } from "eve/events";

// Interaction prompts keep a task open while its caller supplies input.
export const INKBOX_EVE_A2A_INTENT = "ask_caller" as const;

// A signed A2A task is its own input authority within a shared conversation.
export function a2aInputAuth(threadId: string, taskId: string): NonNullable<ChatSdkSendOptions["auth"]> {
  return { authenticator: "inkbox-webhook", issuer: "inkbox:a2a", principalType: "app",
    principalId: JSON.stringify([threadId, taskId]), attributes: {} };
}

function taskFromPrincipal(principal: Principal | undefined, threadId: string): string {
  if (principal?.issuer !== "inkbox:a2a" || principal.type !== "app") throw new Error("Missing A2A task authority.");
  const value: unknown = JSON.parse(principal.id);
  if (!Array.isArray(value) || value.length !== 2 || value[0] !== threadId || typeof value[1] !== "string" || !value[1]) {
    throw new Error("A2A task authority does not match this conversation.");
  }
  return value[1];
}

function boundTask(state: Record<string, unknown>, turnId: string): string {
  const taskId = state[`inkbox:task:${turnId}`];
  if (typeof taskId !== "string" || !taskId) throw new Error("Missing A2A task binding for this turn.");
  return taskId;
}

export function inkboxChannelEvents(
  inkbox: Pick<InkboxAdapter, "decodeThreadId" | "send">,
): ChatSdkChannelEvents {
  return {
    async "delivery.consumed"({ data }, { channel, view }) {
      if (!channel.thread || inkbox.decodeThreadId(channel.thread.id).channel !== "a2a") return;
      const taskId = taskFromPrincipal(delivery(view, data.deliveryId)?.principal, channel.thread.id);
      const key = `inkbox:task:${data.turnId}`;
      if (channel.state[key] !== undefined && channel.state[key] !== taskId) throw new Error("An A2A turn cannot consume another task's input.");
      channel.state[key] = taskId;
    },
    async "turn.started"({ data }, { channel, view }) {
      if (!channel.thread || inkbox.decodeThreadId(channel.thread.id).channel !== "a2a") return;
      if (!("deliveryId" in data.cause)) throw new Error("An A2A turn requires an originating delivery.");
      const taskId = taskFromPrincipal(delivery(view, data.cause.deliveryId)?.principal, channel.thread.id);
      const key = `inkbox:task:${data.turnId}`;
      if (channel.state[key] !== undefined && channel.state[key] !== taskId) throw new Error("An A2A turn cannot change its originating task.");
      channel.state[key] = taskId;
    },
    async committed(_line, { channel, view, session }) {
      const request = nextPrompt(view);
      if (!request) { delete channel.state.shownPromptId; return; }
      if (!channel.thread || channel.state.shownPromptId === request.interactionId) return;
      const text = [request.request.title, request.request.prompt,
        ...(request.request.options ?? []).map((option, index) => `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}`),
        request.request.link?.url,
      ].filter(Boolean).join("\n\n");
      const isA2A = inkbox.decodeThreadId(channel.thread.id).channel === "a2a";
      const taskId = isA2A ? boundTask(channel.state, request.turnId) : undefined;
      if (taskId && channel.state[`inkbox:terminal:${taskId}`] === true) return;
      await channel.bot.initialize();
      await inkbox.send(channel.thread.id, text, {
        ...(taskId ? { a2aTaskId: taskId, a2aIntent: "ask_caller" as const } : {}),
        ...(inkbox.decodeThreadId(channel.thread.id).channel === "email"
          ? { replyToMessageId: channel.thread.toJSON().currentMessage?.id } : {}),
        idempotencyKey: `eve-prompt:${session.id}:${request.interactionId}`,
      });
      channel.state.shownPromptId = request.interactionId;
    },
    async "interaction.opened"({ data }, { channel, view, session }) {
      if (data.request.kind !== "sign-in" || !channel.thread) return;
      const request = interaction(view, data.interactionId);
      if (!request || request.request.signIn?.waitsOn) return;
      const signIn = request.request.signIn;
      const text = [request.request.title, request.request.prompt, signIn?.instructions,
        signIn?.url ?? request.request.link?.url, signIn?.userCode,
      ].filter(Boolean).join("\n\n");
      const taskId = inkbox.decodeThreadId(channel.thread.id).channel === "a2a"
        ? boundTask(channel.state, request.turnId) : undefined;
      if (taskId && channel.state[`inkbox:terminal:${taskId}`] === true) return;
      await channel.bot.initialize();
      await inkbox.send(channel.thread.id, text, {
        ...(taskId ? { a2aTaskId: taskId, a2aIntent: "ask_caller" as const } : {}),
        ...(inkbox.decodeThreadId(channel.thread.id).channel === "email"
          ? { replyToMessageId: channel.thread.toJSON().currentMessage?.id } : {}),
        idempotencyKey: `eve-sign-in:${session.id}:${request.interactionId}`,
      });
    },
    async "content.completed"({ data, scope }, { channel, session }) {
      if (data.kind !== "text" || data.phase !== "reply" || typeof data.value !== "string" || !data.value) return;
      const thread = channel.thread;
      if (!thread) return;
      if (inkbox.decodeThreadId(thread.id).channel === "a2a") {
        if (!scope?.turnId) throw new Error("An A2A reply requires its originating turn.");
        boundTask(channel.state, scope.turnId);
        channel.state[`inkbox:reply:${scope.turnId}:${data.partId}`] = data.value;
        return;
      }
      await channel.bot.initialize();
      await inkbox.send(thread.id, { markdown: data.value }, {
        idempotencyKey: `eve-reply:${session.id}:${session.turn.id}:${data.partId}`,
        ...(inkbox.decodeThreadId(thread.id).channel === "email"
          ? { replyToMessageId: thread.toJSON().currentMessage?.id } : {}),
      });
    },
    async "turn.settled"({ data }, { channel, session }) {
      const thread = channel.thread;
      if (!thread) return;
      const isA2A = inkbox.decodeThreadId(thread.id).channel === "a2a";
      if (!isA2A) {
        if (data.outcome === "failed") {
          await channel.bot.initialize();
          await inkbox.send(thread.id, "I could not complete that request. Please try again.", {
            idempotencyKey: `eve-failure:${session.id}:${data.turnId}`,
            ...(inkbox.decodeThreadId(thread.id).channel === "email"
              ? { replyToMessageId: thread.toJSON().currentMessage?.id } : {}),
          });
        }
        return;
      }
      const taskId = boundTask(channel.state, data.turnId);
      if (channel.state[`inkbox:terminal:${taskId}`] === true) return;
      const prefix = `inkbox:reply:${data.turnId}:`;
      const keys = Object.keys(channel.state).filter(key => key.startsWith(prefix));
      if (data.outcome === "cancelled") {
        for (const key of keys) delete channel.state[key];
        return;
      }
      const replyKeys = data.reply ? data.reply.map(partId => `${prefix}${partId}`) : keys;
      const text = replyKeys.map(key => channel.state[key]).filter((value): value is string => typeof value === "string").join("\n\n");
      const completed = data.outcome === "completed" && text.length > 0;
      await channel.bot.initialize();
      await inkbox.send(thread.id,
        completed ? text : "The agent could not complete this task.",
        { a2aTaskId: taskId, a2aIntent: completed ? "complete" : "fail", idempotencyKey: `eve-task:${session.id}:${data.turnId}` },
      );
      channel.state[`inkbox:terminal:${taskId}`] = true;
      for (const key of keys) delete channel.state[key];
    },
    async "session.ended"({ data }, { channel, session }) {
      if (data.outcome !== "failed" || !channel.thread) return;
      const isA2A = inkbox.decodeThreadId(channel.thread.id).channel === "a2a";
      const taskId = isA2A ? boundTask(channel.state, session.turn.id) : undefined;
      if (taskId && channel.state[`inkbox:terminal:${taskId}`] === true) return;
      await channel.bot.initialize();
      await inkbox.send(channel.thread.id, "This session could not recover. Please start a new request.", {
        ...(taskId ? { a2aTaskId: taskId, a2aIntent: "fail" as const } : {}),
        idempotencyKey: `eve-session-failure:${session.id}`,
        ...(inkbox.decodeThreadId(channel.thread.id).channel === "email"
          ? { replyToMessageId: channel.thread.toJSON().currentMessage?.id } : {}),
      });
      if (taskId) channel.state[`inkbox:terminal:${taskId}`] = true;
    },
  };
}
