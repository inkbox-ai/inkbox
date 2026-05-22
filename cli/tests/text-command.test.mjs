import assert from "node:assert/strict";
import test from "node:test";
import { buildTextSendOptions } from "../dist/commands/text.js";

test("buildTextSendOptions builds a one-to-one send", () => {
  const result = buildTextSendOptions({
    identity: "support-bot",
    to: " +15551234567 ",
    text: "Hello",
  });

  assert.deepEqual(result, {
    sendOptions: {
      to: "+15551234567",
      text: "Hello",
    },
  });
});

test("buildTextSendOptions builds a group MMS send", () => {
  const result = buildTextSendOptions({
    identity: "support-bot",
    to: "+15551234567, +15557654321",
    text: "Hello group",
    mediaUrl: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
  });

  assert.deepEqual(result, {
    sendOptions: {
      to: ["+15551234567", "+15557654321"],
      text: "Hello group",
      mediaUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    },
  });
});

test("buildTextSendOptions builds a conversation reply", () => {
  const result = buildTextSendOptions({
    identity: "support-bot",
    conversationId: "eeee1111-0000-0000-0000-0000000000fa",
    mediaUrl: ["https://example.com/photo.jpg"],
  });

  assert.deepEqual(result, {
    sendOptions: {
      conversationId: "eeee1111-0000-0000-0000-0000000000fa",
      mediaUrls: ["https://example.com/photo.jpg"],
    },
  });
});

test("buildTextSendOptions rejects conflicting destination forms", () => {
  const result = buildTextSendOptions({
    identity: "support-bot",
    to: "+15551234567",
    conversationId: "eeee1111-0000-0000-0000-0000000000fa",
    text: "Hello",
  });

  assert.deepEqual(result, {
    error: "Pass either --to or --conversation-id, not both.",
  });
});

test("buildTextSendOptions rejects missing destination", () => {
  const result = buildTextSendOptions({
    identity: "support-bot",
    text: "Hello",
  });

  assert.deepEqual(result, {
    error: "Pass --to or --conversation-id.",
  });
});

test("buildTextSendOptions rejects empty content", () => {
  const result = buildTextSendOptions({
    identity: "support-bot",
    to: "+15551234567",
  });

  assert.deepEqual(result, {
    error: "Pass --text, --media-url, or both.",
  });
});
