//! RFC 6455 WebSocket frame codec, plus the length-prefixed JSON envelope
//! the WS-bridge stream carries.
//!
//! Used by the WS upgrade bridge and the passthrough TCP bridge (which
//! tunnels raw bytes inside WS BINARY frames on an extended-CONNECT stream).
//! Pure; no h2 imports.
//!
//! Ported from `inkbox/tunnels/client/_wsframe.py` byte-for-byte.

use serde_json::Value;

pub const WS_OPCODE_CONTINUATION: u8 = 0x0;
pub const WS_OPCODE_TEXT: u8 = 0x1;
pub const WS_OPCODE_BINARY: u8 = 0x2;
pub const WS_OPCODE_CLOSE: u8 = 0x8;
pub const WS_OPCODE_PING: u8 = 0x9;
pub const WS_OPCODE_PONG: u8 = 0xA;

/// A decoded WS frame: `(opcode, payload, fin)`.
pub type WsFrame = (u8, Vec<u8>, bool);

/// Drain as many complete WS frames as possible from `buf`.
///
/// Mutates `buf` in place; trailing partial frames stay for the next call.
/// Returns `(opcode, payload, fin)` tuples in arrival order. This mirrors the
/// Python `decode_ws_frames(bytearray)` accumulate-across-calls contract: a
/// single h2 DATA frame can carry zero, one, many, or partial WS frames.
pub fn decode_ws_frames(buf: &mut Vec<u8>) -> Vec<WsFrame> {
    let mut frames: Vec<WsFrame> = Vec::new();
    loop {
        if buf.len() < 2 {
            return frames;
        }
        let b0 = buf[0];
        let b1 = buf[1];
        let fin = (b0 & 0x80) != 0;
        let opcode = b0 & 0x0F;
        let masked = (b1 & 0x80) != 0;
        let mut plen = (b1 & 0x7F) as usize;
        let mut offset = 2usize;
        if plen == 126 {
            if buf.len() < 4 {
                return frames;
            }
            plen = u16::from_be_bytes([buf[2], buf[3]]) as usize;
            offset = 4;
        } else if plen == 127 {
            if buf.len() < 10 {
                return frames;
            }
            let mut be = [0u8; 8];
            be.copy_from_slice(&buf[2..10]);
            plen = u64::from_be_bytes(be) as usize;
            offset = 10;
        }
        let mut mask_key: [u8; 4] = [0; 4];
        if masked {
            if buf.len() < offset + 4 {
                return frames;
            }
            mask_key.copy_from_slice(&buf[offset..offset + 4]);
            offset += 4;
        }
        if buf.len() < offset + plen {
            return frames;
        }
        let mut payload = buf[offset..offset + plen].to_vec();
        if masked {
            // Unmask: payload[i] ^= mask_key[i % 4].
            for (i, p) in payload.iter_mut().enumerate() {
                *p ^= mask_key[i % 4];
            }
        }
        // Consume the framed bytes; remainder carries to the next call.
        buf.drain(..offset + plen);
        frames.push((opcode, payload, fin));
    }
}

/// Encode a single WS frame.
///
/// `mask=true` is required for client->server frames per RFC 6455.
/// `fin=false` produces a fragment frame (continuation expected); the URL
/// passthrough bridge needs this so multi-frame messages from the third party
/// are not silently coalesced.
///
/// # Arguments
/// * `opcode` - The WS opcode (low nibble).
/// * `payload` - The frame payload.
/// * `mask` - Whether to mask the payload (client->server requires `true`).
/// * `fin` - The FIN bit.
pub fn encode_ws_frame(opcode: u8, payload: &[u8], mask: bool, fin: bool) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let fin_bit = if fin { 0x80 } else { 0x00 };
    out.push(fin_bit | (opcode & 0x0F));
    let plen = payload.len();
    let mask_bit: u8 = if mask { 0x80 } else { 0x00 };
    if plen < 126 {
        out.push(mask_bit | plen as u8);
    } else if plen < 65536 {
        out.push(mask_bit | 126);
        out.extend_from_slice(&(plen as u16).to_be_bytes());
    } else {
        out.push(mask_bit | 127);
        out.extend_from_slice(&(plen as u64).to_be_bytes());
    }
    if mask {
        let mask_key = random_mask_key();
        out.extend_from_slice(&mask_key);
        for (i, p) in payload.iter().enumerate() {
            out.push(p ^ mask_key[i % 4]);
        }
    } else {
        out.extend_from_slice(payload);
    }
    out
}

/// An outbound websocket message to encode onto the bridge wire.
///
/// Mirrors the Python dict shapes consumed by `encode_ws_envelope`.
#[derive(Debug, Clone)]
pub enum OutboundWsMsg {
    /// `websocket.send` with a text payload.
    SendText(String),
    /// `websocket.send` with a binary payload (base64-wrapped on the wire).
    SendBytes(Vec<u8>),
    /// `websocket.close` with code + reason.
    Close { code: i64, reason: String },
}

/// Encode an outbound websocket message as the wire envelope
/// (length-prefixed JSON).
///
/// The wire shape is a 4-byte big-endian length prefix followed by compact
/// JSON. Binary payloads are base64-encoded to match the server-side bridge
/// (the server `base64`-decodes the `data` field).
pub fn encode_ws_envelope(msg: &OutboundWsMsg) -> Vec<u8> {
    use base64::Engine as _;
    let wire: Value = match msg {
        OutboundWsMsg::SendText(text) => {
            serde_json::json!({ "type": "text", "data": text })
        }
        OutboundWsMsg::SendBytes(bytes) => {
            let data = base64::engine::general_purpose::STANDARD.encode(bytes);
            serde_json::json!({ "type": "binary", "data": data })
        }
        OutboundWsMsg::Close { code, reason } => {
            serde_json::json!({ "type": "close", "code": code, "reason": reason })
        }
    };
    // Compact JSON (no spaces), matching Python `separators=(",", ":")`.
    let payload = serde_json::to_vec(&wire).expect("ws envelope serializes");
    let mut out = Vec::with_capacity(4 + payload.len());
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(&payload);
    out
}

/// 4 random bytes for the WS mask key. Pulls from the OS CSPRNG via
/// `/dev/urandom` (the data-plane runtime is POSIX-only, matching Python's
/// `connect()` platform gate), falling back to a time-seeded value only if
/// the device is unavailable.
fn random_mask_key() -> [u8; 4] {
    let mut key = [0u8; 4];
    if fill_os_random(&mut key) {
        return key;
    }
    // Fallback: never expected on POSIX; derive from the clock so we still
    // mask (RFC 6455 requires a mask, server does not validate randomness).
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    key.copy_from_slice(&nanos.to_le_bytes());
    key
}

/// Fill `buf` with OS randomness from `/dev/urandom`. Returns `false` on any
/// I/O failure so the caller can fall back.
pub(crate) fn fill_os_random(buf: &mut [u8]) -> bool {
    use std::io::Read;
    match std::fs::File::open("/dev/urandom") {
        Ok(mut f) => f.read_exact(buf).is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Mirrors test_ws_frame_roundtrip_binary.
    #[test]
    fn ws_frame_roundtrip_binary() {
        let wire = encode_ws_frame(WS_OPCODE_BINARY, b"hello world", false, true);
        let mut buf = wire;
        let frames = decode_ws_frames(&mut buf);
        assert_eq!(frames.len(), 1);
        let (op, payload, fin) = &frames[0];
        assert_eq!(*op, WS_OPCODE_BINARY);
        assert_eq!(payload, b"hello world");
        assert!(*fin);
    }

    // Mirrors test_ws_frame_roundtrip_text.
    #[test]
    fn ws_frame_roundtrip_text() {
        let wire = encode_ws_frame(WS_OPCODE_TEXT, b"hi", false, true);
        let mut buf = wire;
        let frames = decode_ws_frames(&mut buf);
        assert_eq!(frames[0].0, WS_OPCODE_TEXT);
        assert_eq!(frames[0].1, b"hi");
    }

    // Mirrors test_ws_frame_partial_buffer_keeps_remainder.
    #[test]
    fn ws_frame_partial_buffer_keeps_remainder() {
        let wire = encode_ws_frame(WS_OPCODE_BINARY, b"abcdef", false, true);
        let mut buf = wire[..3].to_vec(); // incomplete
        let frames = decode_ws_frames(&mut buf);
        assert!(frames.is_empty());
        buf.extend_from_slice(&wire[3..]);
        let frames = decode_ws_frames(&mut buf);
        assert_eq!(frames.len(), 1);
    }

    // Mirrors test_ws_frame_masked_decodes_correctly.
    #[test]
    fn ws_frame_masked_decodes_correctly() {
        let wire = encode_ws_frame(WS_OPCODE_BINARY, b"secret", true, true);
        let mut buf = wire;
        let frames = decode_ws_frames(&mut buf);
        assert_eq!(frames[0].1, b"secret");
    }

    // Mirrors test_ws_frame_preserves_fin_false_for_fragmentation.
    #[test]
    fn ws_frame_preserves_fin_false_for_fragmentation() {
        let mut part1 = encode_ws_frame(WS_OPCODE_TEXT, b"ab", false, false);
        let part2 = encode_ws_frame(WS_OPCODE_CONTINUATION, b"cd", false, true);
        part1.extend_from_slice(&part2);
        let frames = decode_ws_frames(&mut part1);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0], (WS_OPCODE_TEXT, b"ab".to_vec(), false));
        assert_eq!(frames[1], (WS_OPCODE_CONTINUATION, b"cd".to_vec(), true));
    }

    // Extended-length (126) frame round-trips through both codecs.
    #[test]
    fn ws_frame_extended_length_16bit() {
        let payload = vec![0xABu8; 300];
        let wire = encode_ws_frame(WS_OPCODE_BINARY, &payload, false, true);
        // 2 header bytes + 2 length bytes + payload.
        assert_eq!(wire.len(), 4 + 300);
        let mut buf = wire;
        let frames = decode_ws_frames(&mut buf);
        assert_eq!(frames[0].1, payload);
    }

    #[test]
    fn ws_envelope_text_shape() {
        let out = encode_ws_envelope(&OutboundWsMsg::SendText("hi".into()));
        let len = u32::from_be_bytes([out[0], out[1], out[2], out[3]]) as usize;
        assert_eq!(len, out.len() - 4);
        let json = std::str::from_utf8(&out[4..]).unwrap();
        assert_eq!(json, r#"{"type":"text","data":"hi"}"#);
    }

    #[test]
    fn ws_envelope_binary_base64() {
        let out = encode_ws_envelope(&OutboundWsMsg::SendBytes(vec![0, 1, 2, 3]));
        let json = std::str::from_utf8(&out[4..]).unwrap();
        // base64 of 0x00010203 == "AAECAw==".
        assert_eq!(json, r#"{"type":"binary","data":"AAECAw=="}"#);
    }

    #[test]
    fn ws_envelope_close_shape() {
        let out = encode_ws_envelope(&OutboundWsMsg::Close {
            code: 1000,
            reason: "bye".into(),
        });
        let json = std::str::from_utf8(&out[4..]).unwrap();
        assert_eq!(json, r#"{"type":"close","code":1000,"reason":"bye"}"#);
    }
}
