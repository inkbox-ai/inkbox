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

test("buildPlaceCallOptions forwards the ws url and origination on client-driven calls", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    wsUrl: "wss://agent.example.com/ws",
    origination: "shared_imessage_number",
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      clientWebsocketUrl: "wss://agent.example.com/ws",
      origination: "shared_imessage_number",
    },
  });
});

test("buildPlaceCallOptions forwards shared iMessage origination", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    origination: "shared_imessage_number",
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      origination: "shared_imessage_number",
    },
  });
});

test("buildPlaceCallOptions forwards explicit dedicated origination", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    origination: "dedicated_number",
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      origination: "dedicated_number",
    },
  });
});

test("buildPlaceCallOptions builds a shared hosted call with mode and reason", () => {
  const result = buildPlaceCallOptions({
    identity: "support-bot",
    to: "+15551234567",
    hosted: true,
    reason: "Book a cleaning next week, mornings preferred",
    origination: "shared_imessage_number",
  });

  assert.deepEqual(result, {
    callOptions: {
      toNumber: "+15551234567",
      mode: "hosted_agent",
      reason: "Book a cleaning next week, mornings preferred",
      origination: "shared_imessage_number",
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
