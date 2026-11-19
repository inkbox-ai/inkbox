import assert from "node:assert/strict";
import { test } from "node:test";
import { createInkboxAdapter } from "@inkbox/chat-sdk-adapter";
import { messageContentOf } from "eve/channels/chat-sdk";
import { eveDeliveryKey } from "../agent/lib/inkbox-input.ts";

for (const channel of ["email", "sms", "imessage", "slack", "a2a"]) {
  test(`${channel} adapter IDs fit Eve admission keys and preserve replay identity`, () => {
    const makeAdapter = () => createInkboxAdapter({ apiKey: "fixture", signingSecret: "fixture", agentHandle: "assistant" });
    const adapter = makeAdapter();
    const identityId = "11111111-2222-3333-4444-555555555555";
    const conversation = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const routes = {
      email: { identityId, channel, emailAddress: "assistant@example.com", threadId: conversation },
      sms: { identityId, channel, conversationId: conversation },
      imessage: { identityId, channel, conversationId: conversation, isGroup: false },
      slack: { identityId, channel, connectionId: conversation, conversationId: "D1234567890" },
      a2a: { identityId, channel, contextId: conversation, taskId: "task-first" },
    };
    const raw = { route: routes[channel], id: conversation, text: "Hello", authorId: "sender", isMe: false, createdAt: new Date("2026-01-01T00:00:00Z") };
    const message = adapter.parseMessage(raw);
    assert.ok(`${message.threadId}:${message.id}`.length > 256, "fixture reproduces oversized legacy key");
    const key = eveDeliveryKey(message.threadId, message.id);
    assert.ok(key.length > 0 && key.length <= 256, "Eve admission contract");
    const replay = makeAdapter().parseMessage(raw);
    assert.equal(eveDeliveryKey(replay.threadId, replay.id), key);
    const next = adapter.parseMessage({ ...raw, id: "different-message" });
    assert.notEqual(eveDeliveryKey(next.threadId, next.id), key);
    assert.notEqual(eveDeliveryKey("different-thread", message.id), key);
  });
}

test("Eve receives the caption, labeled speech, and recording under the original message key", () => {
  const adapter = createInkboxAdapter({ apiKey: "fixture", signingSecret: "fixture", agentHandle: "assistant" });
  const original = {
    route: { identityId: "identity-test", channel: "sms", conversationId: "conversation-test" },
    id: "message-test",
    authorId: "sender-test",
    isMe: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    text: "Notes from today",
    attachments: [{ type: "audio", name: "note.mp3", mimeType: "audio/mpeg", url: "https://example.com/note.mp3" }],
  };
  const received = adapter.parseMessage(original);
  const resolved = adapter.parseMessage({
    ...original,
    voiceNotes: [{ attachmentId: "attachment-test", position: 1, status: "completed", text: "Meet at noon.", errorCode: null }],
  });
  const [captionAndSpeech, recording] = messageContentOf(resolved);
  assert.deepEqual(captionAndSpeech, {
    type: "text",
    text: "Notes from today\n\n[Voice note 1 — automatically transcribed]\nMeet at noon.",
  });
  assert.equal(recording.type, "file");
  assert.equal(recording.mediaType, "audio/mpeg");
  assert.equal(resolved.raw.text, original.text);
  assert.equal(eveDeliveryKey(resolved.threadId, resolved.id), eveDeliveryKey(received.threadId, received.id));
});
