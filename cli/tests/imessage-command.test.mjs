import assert from "node:assert/strict";
import test from "node:test";
import { buildIMessageSendOptions } from "../dist/commands/imessage.js";

test("buildIMessageSendOptions preserves a scalar recipient", () => {
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    to: " +15551234567 ",
    text: "Hello",
  }), { sendOptions: { to: "+15551234567", text: "Hello" } });
});

test("buildIMessageSendOptions builds a group send", () => {
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    to: "+15551234567, +15557654321",
    text: "Hello group",
    mediaUrl: "https://example.com/photo.jpg",
  }), {
    sendOptions: {
      to: ["+15551234567", "+15557654321"],
      text: "Hello group",
      mediaUrls: ["https://example.com/photo.jpg"],
    },
  });
});

test("buildIMessageSendOptions builds a conversation reply", () => {
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    conversationId: "eeee1111-0000-0000-0000-0000000000fa",
    text: "Reply",
  }), {
    sendOptions: {
      conversationId: "eeee1111-0000-0000-0000-0000000000fa",
      text: "Reply",
    },
  });
});

test("buildIMessageSendOptions rejects conflicting destinations", () => {
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    to: "+15551234567",
    conversationId: "eeee1111-0000-0000-0000-0000000000fa",
    text: "Hello",
  }), { error: "Pass either --to or --conversation-id, not both." });
});

test("buildIMessageSendOptions rejects missing destination or content", () => {
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    text: "Hello",
  }), { error: "Pass --to or --conversation-id." });
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    to: "+15551234567",
  }), { error: "Pass --text, --media-url, or both." });
});
