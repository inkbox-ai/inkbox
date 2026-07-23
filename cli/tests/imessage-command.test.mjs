import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";
import {
  buildIMessageSendOptions,
  IMESSAGE_SENDABLE_REACTIONS,
  registerIMessageCommands,
} from "../dist/commands/imessage.js";

test("iMessage reaction choices match the named outbound allowlist", () => {
  assert.deepEqual(IMESSAGE_SENDABLE_REACTIONS, [
    "love",
    "like",
    "dislike",
    "laugh",
    "emphasize",
    "question",
    "eyes",
  ]);
  assert.equal(IMESSAGE_SENDABLE_REACTIONS.includes("custom"), false);
  assert.equal(IMESSAGE_SENDABLE_REACTIONS.includes("🔥"), false);

  const program = new Command();
  registerIMessageCommands(program);
  const imessage = program.commands.find((command) => command.name() === "imessage");
  const react = imessage?.commands.find((command) => command.name() === "react");
  const reactionOption = react?.options.find((option) => option.long === "--reaction");
  assert.deepEqual(reactionOption?.argChoices, IMESSAGE_SENDABLE_REACTIONS);
  assert.equal(reactionOption?.mandatory, true);
});

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
    sendStyle: "confetti",
  }), {
    sendOptions: {
      to: ["+15551234567", "+15557654321"],
      text: "Hello group",
      mediaUrls: ["https://example.com/photo.jpg"],
      sendStyle: "confetti",
    },
  });
});

test("buildIMessageSendOptions builds a conversation reply", () => {
  assert.deepEqual(buildIMessageSendOptions({
    identity: "support-bot",
    conversationId: "eeee1111-0000-0000-0000-0000000000fa",
    text: "Reply",
    mediaUrl: "https://example.com/reply.jpg",
    sendStyle: "lasers",
  }), {
    sendOptions: {
      conversationId: "eeee1111-0000-0000-0000-0000000000fa",
      text: "Reply",
      mediaUrls: ["https://example.com/reply.jpg"],
      sendStyle: "lasers",
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
