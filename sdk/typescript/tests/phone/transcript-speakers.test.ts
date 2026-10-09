import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePhoneTranscript, parsePhoneTranscriptSpeaker, type RawPhoneTranscript } from "../../src/phone/types.js";
import { parseCorrespondenceItem, type RawCallCorrespondenceItem } from "../../src/contacts/correspondence.js";
import type { RawPhoneTranscriptSpeaker, WebhookTranscriptEntry } from "../../src/index.js";

const rows: RawPhoneTranscript[] = JSON.parse(readFileSync(
  new URL("../../../../tests/fixtures/phone_transcript_speakers.json", import.meta.url), "utf8",
));

describe("transcript speaker snapshots", () => {
  it("keeps participants distinct from call side and preserves literal text", () => {
    const turns = rows.map(parsePhoneTranscript);
    expect(turns[0].party).toBe(turns[1].party);
    expect(turns[0].speaker?.id).not.toBe(turns[1].speaker?.id);
    expect(turns[0].speaker?.phoneNumber).toBe(rows[0].speaker?.phone_number);
    expect(turns[2].speaker?.agentIdentityId).toBe(rows[2].speaker?.agent_identity_id);
    expect(turns.map((t) => t.text)).toEqual(rows.map((t) => t.text));
    expect(turns[3].speaker).toBeNull();
    const { speaker: _, ...legacy } = rows[3];
    expect(parsePhoneTranscript(legacy).speaker).toBeNull();
  });

  it("retains attribution in correspondence while webhook types retain wire casing", () => {
    const raw: RawCallCorrespondenceItem = {
      channel: "calls", source_id: rows[0].call_id, direction: "inbound",
      occurred_at: rows[0].created_at, identity_id: "55555555-5555-4555-8555-555555555555",
      status: "completed", detail_url: null, local_phone_number: null, remote_phone_number: "+14155550100", started_at: null, ended_at: null,
      duration_seconds: 3, transcript: rows.map((r) => ({ ...r, marker: null, omitted_turns: null, omitted_ms: null })),
      transcript_abridged: false, transcript_unavailable: false,
    };
    const call = parseCorrespondenceItem(raw);
    if (call.channel !== "calls") throw new Error("Expected call correspondence");
    expect(call.transcript?.map((t) => t.speaker)).toEqual(rows.map((r) => parsePhoneTranscript(r).speaker));
    const entry: WebhookTranscriptEntry = { speaker: rows[0].speaker };
    expect(entry.speaker?.phone_number).toBe("+14155550100");
  });

  it("defaults optional facts without inventing identity", () => {
    const raw: RawPhoneTranscriptSpeaker = { id: "11111111-1111-5111-8111-111111111111", kind: "human" };
    expect(parsePhoneTranscriptSpeaker(raw)).toEqual({
      id: raw.id, kind: raw.kind, name: null, phoneNumber: null, contactId: null, agentIdentityId: null,
    });
  });
});
