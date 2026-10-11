// sdk/typescript/tests/phone/transcript-phone-numbers.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePhoneTranscript, type RawPhoneTranscript } from "../../src/phone/types.js";
import { parseCorrespondenceItem, type RawCallCorrespondenceItem } from "../../src/contacts/correspondence.js";
import type { WebhookTranscriptEntry } from "../../src/index.js";

const rows: RawPhoneTranscript[] = JSON.parse(readFileSync(
  new URL("../../../../tests/fixtures/phone_transcript_numbers.json", import.meta.url), "utf8",
));

describe("transcript phone numbers", () => {
  it("distinguishes remote lines and preserves literal text", () => {
    const turns = rows.map(parsePhoneTranscript);
    expect(turns[0].party).toBe(turns[1].party);
    expect(turns[0].phoneNumber).not.toBe(turns[1].phoneNumber);
    expect(turns.map((t) => t.text)).toEqual(rows.map((t) => t.text));
    expect(turns.map((t) => t.phoneNumber)).toEqual(rows.map((r) => r.phone_number));
    expect(Object.keys(turns[0]).sort()).toEqual([
      "id", "callId", "seq", "tsMs", "party", "text", "createdAt", "phoneNumber",
    ].sort());
    expect(turns[2].phoneNumber).toBeNull();
    expect(turns[3].phoneNumber).toBeNull();
  });

  it("retains per-turn numbers in correspondence and webhook wire types", () => {
    const raw: RawCallCorrespondenceItem = {
      channel: "calls", source_id: rows[0].call_id, direction: "inbound",
      occurred_at: rows[0].created_at, identity_id: "55555555-5555-4555-8555-555555555555",
      status: "completed", detail_url: null, local_phone_number: null, remote_phone_number: "+14155550100", started_at: null, ended_at: null,
      duration_seconds: 3, transcript: rows.map((r) => ({ ...r, marker: null, omitted_turns: null, omitted_ms: null })),
      transcript_abridged: false, transcript_unavailable: false,
    };
    const call = parseCorrespondenceItem(raw);
    if (call.channel !== "calls") throw new Error("Expected call correspondence");
    expect(call.transcript?.map((t) => t.phoneNumber)).toEqual(rows.map((r) => r.phone_number));
    expect(call.transcript?.map((t) => t.text)).toEqual(rows.map((r) => r.text));
    const entry: WebhookTranscriptEntry = { phone_number: rows[0].phone_number };
    expect(entry.phone_number).toBe("+14155550100");
  });

  it("preserves dedicated local numbers and unavailable attribution", () => {
    expect(parsePhoneTranscript({ ...rows[2], phone_number: "+14155550102" }).phoneNumber).toBe("+14155550102");
    expect(parsePhoneTranscript({ ...rows[0], phone_number: null }).phoneNumber).toBeNull();
    const { phone_number: _, ...legacy } = rows[0];
    expect(parsePhoneTranscript(legacy).phoneNumber).toBeNull();
    const shared: WebhookTranscriptEntry = { party: "local", phone_number: null };
    expect(shared.phone_number).toBeNull();
  });
});
