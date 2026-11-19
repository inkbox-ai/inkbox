import type { ChatInstance } from "chat";
import type { MediaTranscription } from "@inkbox/sdk";
import type { InkboxMessage } from "./events.js";
import type { InkboxRoute, TransportMessage } from "./transport.js";

export interface VoiceNote extends MediaTranscription {
  attachmentId?: string;
  /** One-based position in the original media array, including non-audio media. */
  position: number;
}

export function readVoiceNotes(media: unknown): VoiceNote[] {
  if (!Array.isArray(media)) return [];
  return media.flatMap((item, index) => {
    const result = item?.transcription;
    if (
      !result ||
      !["pending", "completed", "failed", "skipped"].includes(result.status)
    )
      return [];
    return [
      {
        attachmentId: typeof item.id === "string" ? item.id : undefined,
        position: index + 1,
        status: result.status,
        text: typeof result.text === "string" ? result.text : null,
        errorCode: result.error_code ?? result.errorCode ?? null,
      },
    ];
  });
}

export function withVoiceNoteLabels(message: InkboxMessage): string {
  const labels = (message.voiceNotes ?? []).flatMap((note) => {
    if (note.errorCode === "not_audio") return [];
    if (note.status === "completed" && note.text?.trim())
      return [`[Voice note ${note.position} — automatically transcribed]\n${note.text}`];
    return [
      `[Voice note ${note.position}: transcript unavailable; process the original attachment normally.]`,
    ];
  });
  return [message.text, ...labels].filter(Boolean).join("\n\n");
}

type State = ReturnType<ChatInstance["getState"]>;
const retention = 24 * 60 * 60 * 1000;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function sourceKey(message: InkboxMessage): string {
  const route = message.route;
  if (route.channel !== "sms" && route.channel !== "imessage")
    throw new Error("Unsupported voice-note channel");
  return (
    "inkbox:voice-note:" +
    JSON.stringify([
      route.identityId,
      route.channel,
      route.conversationId,
      message.id,
    ])
  );
}

export async function recordVoiceNoteCompletion(
  state: State,
  message: InkboxMessage,
): Promise<void> {
  const notes = message.voiceNotes ?? [];
  if (notes.length && notes.every((note) => note.status !== "pending"))
    await state.setIfNotExists(
      sourceKey(message) + ":completion",
      notes,
      retention,
    );
}

function applyResults(
  message: InkboxMessage,
  results: VoiceNote[],
): InkboxMessage {
  const voiceNotes = message.voiceNotes!.map((original) => {
    if (original.status !== "pending") return original;
    const result = results.find((item) =>
      original.attachmentId
        ? item.attachmentId === original.attachmentId
        : item.position === original.position,
    );
    return result && result.status !== "pending"
      ? { ...result, position: original.position }
      : original;
  });
  return { ...message, voiceNotes };
}

/** Only the signed original is admitted to Chat. A completion, even on another
 * receiver instance, supplies data without creating a new message or route. */
export async function resolveVoiceNotes(
  state: State,
  message: InkboxMessage,
  lookup: (route: InkboxRoute, id: string) => Promise<TransportMessage>,
): Promise<InkboxMessage> {
  if (!message.voiceNotes?.some((note) => note.status === "pending"))
    return message;
  const key = sourceKey(message);
  const deadlineKey = key + ":deadline";
  const proposedDeadline = Date.now() + 60_000;
  await state.setIfNotExists(deadlineKey, proposedDeadline, retention);
  const deadline = (await state.get<number>(deadlineKey)) ?? proposedDeadline;

  while (true) {
    const completed = await state.get<VoiceNote[]>(key + ":completion");
    if (completed) {
      const merged = applyResults(message, completed);
      if (!merged.voiceNotes!.some((note) => note.status === "pending"))
        return merged;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    // Check shared webhook state, not the Inkbox API, during the wait.
    await sleep(Math.min(1000, remaining));
  }

  const resultKey = key + ":poll-result";
  if (await state.setIfNotExists(key + ":polled", true, retention)) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let notes: VoiceNote[] = [];
    try {
      const result = await Promise.race([
        lookup(message.route, message.id),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), 10_000);
        }),
      ]);
      if (result?.id === message.id) notes = result.voiceNotes ?? [];
    } catch {
      // The original message and its attachment remain deliverable.
    } finally {
      clearTimeout(timer);
    }
    await state.set(resultKey, notes, retention);
    return applyResults(message, notes);
  }

  // A replay joins the first poll, even when it reached another receiver.
  const pollDeadline = deadline + 10_000;
  while (true) {
    const notes = await state.get<VoiceNote[]>(resultKey);
    if (notes) return applyResults(message, notes);
    const remaining = pollDeadline - Date.now();
    if (remaining <= 0) return message;
    await sleep(Math.min(250, remaining));
  }
}
