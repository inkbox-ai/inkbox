import { describe, it, expect } from "vitest";
import {
  WsEnvelopeDecoder,
  WsFrameDecoder,
  WS_OPCODE_BINARY,
  WS_OPCODE_TEXT,
  encodeWsEnvelope,
  encodeWsFrame,
  __testing,
} from "../../src/tunnels/client/_wsframe.js";

describe("WsFrameDecoder", () => {
  it("decodes a single small unmasked frame", () => {
    const frame = encodeWsFrame(
      WS_OPCODE_TEXT,
      Buffer.from("hi", "utf-8"),
      { mask: false },
    );
    const dec = new WsFrameDecoder();
    const out = dec.feed(frame);
    expect(out).toHaveLength(1);
    expect(out[0].opcode).toBe(WS_OPCODE_TEXT);
    expect(out[0].payload.toString()).toBe("hi");
    expect(out[0].fin).toBe(true);
    expect(dec.hasPartial()).toBe(false);
  });

  it("unmasks masked frames correctly", () => {
    const frame = encodeWsFrame(
      WS_OPCODE_BINARY,
      Buffer.from([0x01, 0x02, 0x03, 0x04]),
      { mask: true },
    );
    const dec = new WsFrameDecoder();
    const out = dec.feed(frame);
    expect(out).toHaveLength(1);
    expect(Array.from(out[0].payload)).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  it("decodes a frame split across three feed() calls (carry-buffer regression)", () => {
    // M3 T1 regression test: split a single WS frame across three calls
    // and assert it decodes exactly once.
    const payload = Buffer.from("a".repeat(200), "utf-8"); // forces 16-bit length
    const frame = encodeWsFrame(WS_OPCODE_TEXT, payload, { mask: false });
    const dec = new WsFrameDecoder();
    const split1 = frame.subarray(0, 1); // partial header
    const split2 = frame.subarray(1, 50); // header tail + part of payload
    const split3 = frame.subarray(50); // remainder
    expect(dec.feed(split1)).toHaveLength(0);
    expect(dec.hasPartial()).toBe(true);
    expect(dec.feed(split2)).toHaveLength(0);
    expect(dec.hasPartial()).toBe(true);
    const final = dec.feed(split3);
    expect(final).toHaveLength(1);
    expect(final[0].payload.length).toBe(200);
    expect(final[0].payload.toString()).toBe("a".repeat(200));
    expect(dec.hasPartial()).toBe(false);
  });

  it("preserves the FIN bit when encoded with fin: false (fragmentation)", () => {
    const part1 = encodeWsFrame(WS_OPCODE_TEXT, Buffer.from("ab"), {
      mask: false, fin: false,
    });
    const part2 = encodeWsFrame(0x0, Buffer.from("cd"), {
      mask: false, fin: true,
    });
    const dec = new WsFrameDecoder();
    const out = dec.feed(Buffer.concat([part1, part2]));
    expect(out).toHaveLength(2);
    expect(out[0].fin).toBe(false);
    expect(out[0].opcode).toBe(WS_OPCODE_TEXT);
    expect(out[0].payload.toString()).toBe("ab");
    expect(out[1].fin).toBe(true);
    expect(out[1].opcode).toBe(0x0);
    expect(out[1].payload.toString()).toBe("cd");
  });

  it("decodes multiple frames in a single feed()", () => {
    const f1 = encodeWsFrame(WS_OPCODE_TEXT, Buffer.from("a"), { mask: false });
    const f2 = encodeWsFrame(WS_OPCODE_TEXT, Buffer.from("b"), { mask: false });
    const f3 = encodeWsFrame(WS_OPCODE_TEXT, Buffer.from("c"), { mask: false });
    const dec = new WsFrameDecoder();
    const out = dec.feed(Buffer.concat([f1, f2, f3]));
    expect(out).toHaveLength(3);
    expect(out.map((f) => f.payload.toString())).toEqual(["a", "b", "c"]);
  });

  it("retains a partial trailing frame across calls", () => {
    const f1 = encodeWsFrame(WS_OPCODE_TEXT, Buffer.from("hi"), { mask: false });
    const f2 = encodeWsFrame(WS_OPCODE_TEXT, Buffer.from("ok"), { mask: false });
    const concat = Buffer.concat([f1, f2]);
    // Cut mid-second-frame.
    const cut = f1.length + 2;
    const dec = new WsFrameDecoder();
    let out = dec.feed(concat.subarray(0, cut));
    expect(out).toHaveLength(1);
    expect(out[0].payload.toString()).toBe("hi");
    expect(dec.hasPartial()).toBe(true);
    out = dec.feed(concat.subarray(cut));
    expect(out).toHaveLength(1);
    expect(out[0].payload.toString()).toBe("ok");
  });

  it("supports 16-bit and 64-bit length encodings", () => {
    const big = Buffer.alloc(70_000);
    big.fill("x");
    const frame = encodeWsFrame(WS_OPCODE_BINARY, big, { mask: false });
    const dec = new WsFrameDecoder();
    const out = dec.feed(frame);
    expect(out).toHaveLength(1);
    expect(out[0].payload.length).toBe(70_000);
  });
});

describe("encodeWsEnvelope", () => {
  // Mirrors Python test_encode_ws_envelope_binary_uses_base64.
  it("base64-encodes binary payloads on the wire", () => {
    const payload = Buffer.concat([
      Buffer.from([0x00, 0xff, 0x80]),
      Buffer.from("hello", "utf-8"),
    ]);
    const out = encodeWsEnvelope({ type: "websocket.send", bytes: payload });
    // Strip 4-byte length prefix to inspect the JSON.
    const len = out.readUInt32BE(0);
    const json = JSON.parse(out.subarray(4, 4 + len).toString("utf-8"));
    expect(json.type).toBe("binary");
    expect(json.data).toBe(payload.toString("base64"));
  });

  it("encodes text payloads as UTF-8 inline", () => {
    const out = encodeWsEnvelope({ type: "websocket.send", text: "héllo" });
    const len = out.readUInt32BE(0);
    const json = JSON.parse(out.subarray(4, 4 + len).toString("utf-8"));
    expect(json.type).toBe("text");
    expect(json.data).toBe("héllo");
  });

  it("encodes a close envelope with code and reason", () => {
    const out = encodeWsEnvelope({
      type: "websocket.close",
      code: 1011,
      reason: "boom",
    });
    const len = out.readUInt32BE(0);
    const json = JSON.parse(out.subarray(4, 4 + len).toString("utf-8"));
    expect(json).toEqual({ type: "close", code: 1011, reason: "boom" });
  });
});

describe("WsEnvelopeDecoder", () => {
  it("base64-decodes binary inbound payloads", () => {
    const original = Buffer.from([0x00, 0xff, 0x80, 0x42]);
    const wire = encodeWsEnvelope({ type: "websocket.send", bytes: original });
    const dec = new WsEnvelopeDecoder();
    const out = dec.feed(wire);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("binary");
    if (out[0].type === "binary") {
      expect(Array.from(out[0].data)).toEqual([0x00, 0xff, 0x80, 0x42]);
    }
  });

  it("drops malformed-base64 inbound binary frames", () => {
    // Manually build the wire envelope with garbage base64.
    const json = Buffer.from(
      JSON.stringify({ type: "binary", data: "@@@@" }),
      "utf-8",
    );
    const wire = Buffer.alloc(4 + json.length);
    wire.writeUInt32BE(json.length, 0);
    json.copy(wire, 4);
    const dec = new WsEnvelopeDecoder();
    expect(dec.feed(wire)).toEqual([]);
  });

  it("rejects unpadded base64 inbound binary frames", () => {
    // "aGVsbG8" is "hello" without trailing "=" padding.
    const json = Buffer.from(
      JSON.stringify({ type: "binary", data: "aGVsbG8" }),
      "utf-8",
    );
    const wire = Buffer.alloc(4 + json.length);
    wire.writeUInt32BE(json.length, 0);
    json.copy(wire, 4);
    const dec = new WsEnvelopeDecoder();
    expect(dec.feed(wire)).toEqual([]);
  });

  it("decodes text envelopes", () => {
    const wire = encodeWsEnvelope({ type: "websocket.send", text: "hello" });
    const out = new WsEnvelopeDecoder().feed(wire);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ type: "text", data: "hello" });
  });

  it("re-assembles envelopes split across feed() calls", () => {
    const wire = encodeWsEnvelope({ type: "websocket.send", text: "hello" });
    const dec = new WsEnvelopeDecoder();
    expect(dec.feed(wire.subarray(0, 3))).toEqual([]);
    expect(dec.feed(wire.subarray(3))).toHaveLength(1);
  });
});

describe("strict base64 round-trip", () => {
  it("rejects strings with non-base64 characters", () => {
    expect(__testing.decodeStrictBase64("aGVs!G8=")).toBeNull();
  });
  it("rejects strings whose length is not a multiple of 4", () => {
    expect(__testing.decodeStrictBase64("aGVsbG8")).toBeNull();
  });
  it("accepts well-formed base64", () => {
    const decoded = __testing.decodeStrictBase64("aGVsbG8=");
    expect(decoded).not.toBeNull();
    expect(decoded!.toString()).toBe("hello");
  });
});
