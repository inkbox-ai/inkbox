import { describe, it, expect, vi } from "vitest";
import { TranscriptsResource } from "../../src/phone/resources/transcripts.js";
import type { HttpTransport } from "../../src/_http.js";
import { RAW_PHONE_TRANSCRIPT } from "../sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const NUM_ID = "aaaa1111-0000-0000-0000-000000000001";
const CALL_ID = "bbbb2222-0000-0000-0000-000000000001";

describe("TranscriptsResource.list", () => {
  it("returns transcript segments", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_PHONE_TRANSCRIPT]);
    const res = new TranscriptsResource(http);

    const transcripts = await res.list(NUM_ID, CALL_ID);

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/calls/${CALL_ID}/transcripts`);
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0].text).toBe("Hello, how can I help you?");
    expect(transcripts[0].seq).toBe(0);
  });

  it("returns empty array", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new TranscriptsResource(http);
    expect(await res.list(NUM_ID, CALL_ID)).toEqual([]);
  });
});
