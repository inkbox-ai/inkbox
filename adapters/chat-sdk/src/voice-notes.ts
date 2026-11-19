import { createHmac, randomUUID } from "node:crypto";
import type { ChatInstance } from "chat";
import type { MediaTranscription } from "@inkbox/sdk";
import type { InkboxMessage } from "./events.js";
import type { InkboxRoute, TransportMessage } from "./transport.js";

export const recoveryEvent = "adapter.voice_notes_due";

/** Send to your own adapter webhook from a trusted recurring job. */
export function createVoiceNoteRecoveryRequest(
  url: string,
  signingSecret: string,
): Request {
  const body = JSON.stringify({ event_type: recoveryEvent });
  const requestId = randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", signingSecret.replace(/^whsec_/, ""))
    .update(requestId + "." + timestamp + "." + body)
    .digest("hex");
  return new Request(url, {
    method: "POST",
    body,
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "x-inkbox-request-id": requestId,
      "x-inkbox-timestamp": timestamp,
      "x-inkbox-signature": "sha256=" + signature,
    },
  });
}

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
    if (note.status === "completed") {
      if (!note.text?.trim())
        return [`[Voice note ${note.position}: no speech detected]`];
      return [
        `[Voice note ${note.position} — automatically transcribed]\n${note.text}`,
      ];
    }
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

export function sourceKey(message: InkboxMessage): string {
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

interface Accepted {
  message: InkboxMessage;
  deadline: number;
}

function indexKey(identityId: string) {
  return "inkbox:pending-voice-notes:" + identityId;
}

// StateAdapter has no key scan. Keep a discoverable index, including while a
// worker owns a delivery; a crash must never pop the only reference to work.
async function editIndex(
  state: State,
  identityId: string,
  edit: (keys: Set<string>) => Promise<void>,
) {
  const index = indexKey(identityId);
  let lock = await state.acquireLock(index, 30_000);
  for (let attempt = 0; !lock && attempt < 10; attempt++) {
    await sleep(25);
    lock = await state.acquireLock(index, 30_000);
  }
  if (!lock) throw new Error("Voice-note index is busy; retry delivery");
  try {
    const keys = new Set(await pendingVoiceNotes(state, identityId));
    await edit(keys);
    if (!(await state.extendLock(lock, 30_000)))
      throw new Error("Voice-note index lease expired; retry delivery");
    await state.set(index, [...keys]);
  } finally {
    await state.releaseLock(lock);
  }
}

export async function pendingVoiceNotes(state: State, identityId: string) {
  return (await state.get<string[]>(indexKey(identityId))) ?? [];
}

export async function acceptVoiceNote(state: State, message: InkboxMessage) {
  const key = sourceKey(message);
  await editIndex(state, message.route.identityId, async (keys) => {
    if (await state.get(key + ":done")) return;
    await state.setIfNotExists(key, { message, deadline: Date.now() + 60_000 });
    keys.add(key);
  });
}

async function retireVoiceNote(state: State, identityId: string, key: string) {
  await editIndex(state, identityId, async (keys) => {
    await state.delete(key);
    keys.delete(key);
  });
}

export async function recordVoiceNoteCompletion(
  state: State,
  message: InkboxMessage,
): Promise<void> {
  const notes = message.voiceNotes ?? [];
  if (!notes.length || notes.some((note) => note.status === "pending")) return;
  const key = sourceKey(message);
  const accepted = await state.get<Accepted>(key);
  if (accepted && Date.now() > accepted.deadline) return;
  await state.setIfNotExists(key + ":completion", notes, retention);
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

async function pollOnce(
  state: State,
  key: string,
  messageId: string,
  lookup: () => Promise<TransportMessage>,
): Promise<VoiceNote[]> {
  const resultKey = key + ":poll-result";
  // Claim the one allowed read with its fallback result before issuing it.
  // A worker lost mid-read leaves the original deliverable on the next tick.
  if (!(await state.setIfNotExists(resultKey, [])))
    return (await state.get<VoiceNote[]>(resultKey)) ?? [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let notes: VoiceNote[] = [];
  try {
    const result = await Promise.race([
      lookup(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), 10_000);
      }),
    ]);
    if (result?.id === messageId) notes = result.voiceNotes ?? [];
  } catch {
    // Retain the original attachment.
  } finally {
    clearTimeout(timer);
  }
  await state.set(resultKey, notes);
  return notes;
}

/** Completion webhooks and scheduled recovery can both claim a saved original.
 * A host-provided waitUntil may also wake it at its original deadline. */
export async function deliverVoiceNote(
  state: State,
  key: string,
  identityId: string,
  mode: "ready" | "due" | "wait",
  lookup: (route: InkboxRoute, id: string) => Promise<TransportMessage>,
  deliver: (message: InkboxMessage) => Promise<void>,
): Promise<void> {
  const accepted = await state.get<Accepted>(key);
  if (!accepted) {
    // A worker can crash between deleting a delivered record and its index entry.
    if (await state.get(key + ":done"))
      await retireVoiceNote(state, identityId, key);
    return;
  }
  const { deadline, message } = accepted;
  async function completed() {
    const notes = await state.get<VoiceNote[]>(key + ":completion");
    if (!notes) return;
    const merged = applyResults(message, notes);
    if (merged.voiceNotes!.every((note) => note.status !== "pending"))
      return merged;
  }
  let ready = await completed();
  if (!ready && mode === "ready") return;
  while (!ready && Date.now() < deadline) {
    if (mode !== "wait") return;
    await sleep(Math.min(1000, deadline - Date.now()));
    if (await state.get(key + ":done")) return;
    ready = await completed();
  }
  const lock = await state.acquireLock(key + ":delivery", 120_000);
  if (!lock) return;
  const renew = setInterval(() => {
    // If the backend is unavailable the lease can lapse. The stable delivery
    // ID also protects idempotent handlers across a crash at this boundary.
    void state.extendLock(lock, 120_000).catch(() => {});
  }, 40_000);
  try {
    if (!(await state.get(key + ":done"))) {
      if (!ready) {
        const notes = await pollOnce(state, key, message.id, () =>
          lookup(message.route, message.id),
        );
        ready = applyResults(message, notes);
      }
      await deliver(ready);
      await state.set(key + ":done", true, retention);
    }
    await state.delete(key + ":poll-result");
    await retireVoiceNote(state, identityId, key);
  } finally {
    clearInterval(renew);
    await state.releaseLock(lock);
  }
}
