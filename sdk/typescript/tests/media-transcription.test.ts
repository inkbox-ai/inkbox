import { describe, expect, it } from "vitest";
import { parseTextMediaItem } from "../src/phone/types.js";
import { parseIMessageMediaItem } from "../src/imessage/types.js";
import { parseWhatsAppMedia } from "../src/whatsapp.js";
import type { MediaTranscription, TranscriptionStatus } from "../src/index.js";

const base = { id: "00000000-0000-4000-8000-000000000001", filename: "audio.m4a", content_type: "audio/mp4", size: 42, url: "https://example.com/audio", status: "ready" as const };
describe("audio transcription", () => {
  for (const parse of [parseTextMediaItem, parseIMessageMediaItem, parseWhatsAppMedia]) {
    for (const status of ["pending", "completed", "failed", "skipped"] as TranscriptionStatus[]) {
      it(`preserves ${status} transcription through ${parse.name}`, () => {
        const text = status === "completed" ? "" : null;
        const error_code = status === "failed" ? "transcription_failed" : null;
        const result: MediaTranscription | null | undefined = parse({ ...base, transcription: { status, text, error_code } }).transcription;
        expect(result).toEqual({ status, text, errorCode: error_code });
      });
    }
    it(`accepts omitted and null transcription through ${parse.name}`, () => {
      expect(parse(base).transcription).toBeNull();
      expect(parse({ ...base, transcription: null }).transcription).toBeNull();
    });
  }
  it("accepts legacy MMS and iMessage without IDs", () => {
    const { id, ...legacy } = base;
    expect(parseTextMediaItem(legacy).id).toBeNull();
    expect(parseIMessageMediaItem(legacy).id).toBeNull();
  });
});
