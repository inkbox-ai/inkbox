import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaceCallOptions } from "../dist/commands/phone.js";

test("buildPlaceCallOptions builds a plain client-driven call", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
  });

  // No mode key: the SDK defaults it to client_websocket on the wire.
  assert.deepEqual(result, {
    callOptions: { toNumber: "+15551234567" },
  });
});

test("buildPlaceCallOptions forwards the ws url on client-driven calls", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    wsUrl: "wss://agent.example.com/ws",
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      clientWebsocketUrl: "wss://agent.example.com/ws",
    },
  });
});

test("buildPlaceCallOptions builds a hosted call with mode and reason", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    hosted: true,
    reason: "Book a cleaning next week, mornings preferred",
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      mode: "hosted_agent",
      reason: "Book a cleaning next week, mornings preferred",
    },
  });
});

test("buildPlaceCallOptions rejects --hosted without --reason", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    hosted: true,
  });

  assert.deepEqual(result, {
    error: "--hosted requires --reason (the agent's task brief).",
  });
});

test("buildPlaceCallOptions rejects --hosted with --ws-url", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    hosted: true,
    reason: "Confirm the appointment",
    wsUrl: "wss://agent.example.com/ws",
  });

  assert.deepEqual(result, {
    error: "--hosted conflicts with --ws-url (Voice AI calls need no socket).",
  });
});

test("buildPlaceCallOptions rejects --reason without --hosted", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    reason: "Confirm the appointment",
  });

  assert.deepEqual(result, {
    error: "--reason is only valid with --hosted.",
  });
});
