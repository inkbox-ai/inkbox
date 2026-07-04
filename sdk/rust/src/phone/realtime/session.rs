//! The realtime control channel: an async observe stream plus intervene
//! commands.
//!
//! The transport is a client WebSocket built on `tokio` + `tokio-rustls`,
//! framed with the shared RFC 6455 codec (`crate::tunnels::client::wsframe`).
//! `RealtimeResource::connect` opens the channel and subscribes; the returned
//! session yields typed events via [`RealtimeControlSession::next`] and sends
//! commands with the intervene methods.

use std::collections::VecDeque;
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use url::Url;

use crate::error::{InkboxError, Result};
use crate::phone::realtime::events::{parse_event, RealtimeEvent};
use crate::tunnels::client::wsframe::{
    decode_ws_frames, encode_ws_frame, WsFrame, WS_OPCODE_BINARY, WS_OPCODE_CLOSE, WS_OPCODE_PING,
    WS_OPCODE_PONG, WS_OPCODE_TEXT,
};

const CONTROL_PATH: &str = "/api/v1/phone/ws/realtime-control";
const HANDSHAKE_LIMIT: usize = 64 * 1024;
const READ_CHUNK: usize = 65536;

/// Any duplex byte stream the transport can drive (plain TCP or TLS).
trait IoStream: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send {}
impl<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send> IoStream for T {}

/// Client WebSocket over an async (optionally TLS) stream.
struct WsTransport {
    stream: Box<dyn IoStream>,
    buf: Vec<u8>,
    frames: VecDeque<WsFrame>,
    fragments: Vec<u8>,
    frag_opcode: u8,
    closed: bool,
}

impl WsTransport {
    async fn connect(url: &Url, service_token: &str) -> Result<Self> {
        let secure = url.scheme() == "wss";
        let host = url
            .host_str()
            .ok_or_else(|| InkboxError::InvalidArgument("control url has no host".into()))?
            .to_string();
        let port = url.port().unwrap_or(if secure { 443 } else { 80 });

        let tcp = TcpStream::connect((host.as_str(), port))
            .await
            .map_err(|e| InkboxError::Tunnel(format!("control channel connect failed: {e}")))?;
        let stream: Box<dyn IoStream> = if secure {
            Box::new(tls_connect(tcp, &host).await?)
        } else {
            Box::new(tcp)
        };

        let mut self_ = Self {
            stream,
            buf: Vec::new(),
            frames: VecDeque::new(),
            fragments: Vec::new(),
            frag_opcode: 0,
            closed: false,
        };
        self_.handshake(url, &host, service_token).await?;
        Ok(self_)
    }

    async fn handshake(&mut self, url: &Url, host: &str, service_token: &str) -> Result<()> {
        let mut key = [0u8; 16];
        crate::tunnels::client::wsframe::fill_os_random(&mut key);
        use base64::Engine as _;
        let key_b64 = base64::engine::general_purpose::STANDARD.encode(key);
        let mut path = url.path().to_string();
        if let Some(query) = url.query() {
            path.push('?');
            path.push_str(query);
        }
        let request = format!(
            "GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n\
             Connection: Upgrade\r\nSec-WebSocket-Key: {key_b64}\r\n\
             Sec-WebSocket-Version: 13\r\nX-Service-Token: {service_token}\r\n\r\n"
        );
        self.stream
            .write_all(request.as_bytes())
            .await
            .map_err(|e| InkboxError::Tunnel(format!("control channel write failed: {e}")))?;

        // Read the response head up to the CRLFCRLF terminator.
        let mut head: Vec<u8> = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            let n =
                self.stream.read(&mut byte).await.map_err(|e| {
                    InkboxError::Tunnel(format!("control channel read failed: {e}"))
                })?;
            if n == 0 {
                return Err(InkboxError::Tunnel(
                    "control channel closed during handshake".into(),
                ));
            }
            head.push(byte[0]);
            if head.ends_with(b"\r\n\r\n") {
                break;
            }
            if head.len() > HANDSHAKE_LIMIT {
                return Err(InkboxError::Tunnel("handshake response too large".into()));
            }
        }
        let status_line = head
            .split(|&b| b == b'\r')
            .next()
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .unwrap_or_default();
        let code = status_line
            .split_whitespace()
            .nth(1)
            .and_then(|c| c.parse::<u16>().ok())
            .unwrap_or(0);
        if code != 101 {
            return Err(InkboxError::Tunnel(format!(
                "control channel upgrade rejected: {}",
                status_line.trim()
            )));
        }
        Ok(())
    }

    async fn send_text(&mut self, text: &str) -> Result<()> {
        if self.closed {
            return Err(InkboxError::Tunnel("control channel is closed".into()));
        }
        let frame = encode_ws_frame(WS_OPCODE_TEXT, text.as_bytes(), true, true);
        self.stream
            .write_all(&frame)
            .await
            .map_err(|e| InkboxError::Tunnel(format!("control channel write failed: {e}")))?;
        Ok(())
    }

    /// Next text message, or `None` once the peer closes.
    async fn recv(&mut self) -> Result<Option<String>> {
        loop {
            while let Some((opcode, payload, fin)) = self.frames.pop_front() {
                match opcode {
                    WS_OPCODE_CLOSE => {
                        self.closed = true;
                        return Ok(None);
                    }
                    WS_OPCODE_PING => {
                        self.send_pong(&payload).await?;
                    }
                    WS_OPCODE_PONG => {}
                    _ => {
                        if let Some(text) = self.assemble(opcode, payload, fin) {
                            return Ok(Some(text));
                        }
                    }
                }
            }
            if self.closed {
                return Ok(None);
            }
            let mut chunk = vec![0u8; READ_CHUNK];
            let n =
                self.stream.read(&mut chunk).await.map_err(|e| {
                    InkboxError::Tunnel(format!("control channel read failed: {e}"))
                })?;
            if n == 0 {
                self.closed = true;
                return Ok(None);
            }
            self.buf.extend_from_slice(&chunk[..n]);
            self.frames.extend(decode_ws_frames(&mut self.buf));
        }
    }

    /// Reassemble (possibly fragmented) TEXT/BINARY frames; returns the UTF-8
    /// text of a complete text message, or `None` for binary / partial frames.
    fn assemble(&mut self, opcode: u8, payload: Vec<u8>, fin: bool) -> Option<String> {
        let is_data = opcode == WS_OPCODE_TEXT || opcode == WS_OPCODE_BINARY;
        if is_data && fin && self.fragments.is_empty() {
            return (opcode == WS_OPCODE_TEXT)
                .then(|| String::from_utf8_lossy(&payload).into_owned());
        }
        if is_data {
            self.frag_opcode = opcode;
        }
        self.fragments.extend_from_slice(&payload);
        if !fin {
            return None;
        }
        let data = std::mem::take(&mut self.fragments);
        let was_text = self.frag_opcode == WS_OPCODE_TEXT;
        self.frag_opcode = 0;
        was_text.then(|| String::from_utf8_lossy(&data).into_owned())
    }

    async fn send_pong(&mut self, payload: &[u8]) -> Result<()> {
        if self.closed {
            return Ok(());
        }
        let frame = encode_ws_frame(WS_OPCODE_PONG, payload, true, true);
        let _ = self.stream.write_all(&frame).await;
        Ok(())
    }

    async fn close(&mut self) -> Result<()> {
        if !self.closed {
            self.closed = true;
            let frame = encode_ws_frame(WS_OPCODE_CLOSE, b"", true, true);
            let _ = self.stream.write_all(&frame).await;
        }
        let _ = self.stream.shutdown().await;
        Ok(())
    }
}

async fn tls_connect(
    tcp: TcpStream,
    host: &str,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let server_name = rustls::pki_types::ServerName::try_from(host.to_string())
        .map_err(|e| InkboxError::Tunnel(format!("invalid tls server name: {e}")))?;
    tokio_rustls::TlsConnector::from(Arc::new(config))
        .connect(server_name, tcp)
        .await
        .map_err(|e| InkboxError::Tunnel(format!("control channel tls failed: {e}")))
}

/// Live observe + intervene handle for one control-channel connection.
///
/// Call [`Self::next`] to receive the next observe event (async-iterator
/// style; returns `Ok(None)` when the peer closes) and the intervene methods
/// to steer the live call.
pub struct RealtimeControlSession {
    transport: WsTransport,
}

impl RealtimeControlSession {
    /// Await the next observe event, or `Ok(None)` once the channel closes.
    pub async fn next(&mut self) -> Result<Option<RealtimeEvent>> {
        match self.transport.recv().await? {
            Some(text) => Ok(Some(parse_event(&text)?)),
            None => Ok(None),
        }
    }

    async fn send(&mut self, command: &Value) -> Result<()> {
        self.transport
            .send_text(&serde_json::to_string(command)?)
            .await
    }

    /// Resolve a `consult.requested` with an answer for the caller.
    pub async fn answer_consult(
        &mut self,
        consult_id: &str,
        answer: &str,
        instructions: Option<&str>,
    ) -> Result<()> {
        self.send(&consult_answer_command(consult_id, answer, instructions))
            .await
    }

    /// Have the voice agent speak `text` on the call now.
    pub async fn say(&mut self, call_id: &str, text: &str) -> Result<()> {
        self.send(&inject_command(call_id, "say", text)).await
    }

    /// Add hidden system context to the live session without speaking.
    pub async fn inject_context(&mut self, call_id: &str, text: &str) -> Result<()> {
        self.send(&inject_command(call_id, "context", text)).await
    }

    /// Approve a tool call awaiting a decision.
    pub async fn approve_tool(&mut self, call_id: &str, tool_call_id: &str) -> Result<()> {
        self.send(&tool_decision_command(
            call_id,
            tool_call_id,
            "approve",
            None,
        ))
        .await
    }

    /// Deny a tool call awaiting a decision.
    pub async fn deny_tool(
        &mut self,
        call_id: &str,
        tool_call_id: &str,
        reason: Option<&str>,
    ) -> Result<()> {
        self.send(&tool_decision_command(
            call_id,
            tool_call_id,
            "deny",
            reason,
        ))
        .await
    }

    /// Replace the live session instructions.
    pub async fn update_instructions(&mut self, call_id: &str, instructions: &str) -> Result<()> {
        self.send(&json!({
            "event": "update_instructions",
            "call_id": call_id,
            "instructions": instructions,
        }))
        .await
    }

    /// Force-end the call.
    pub async fn hang_up(&mut self, call_id: &str, reason: Option<&str>) -> Result<()> {
        let mut command = json!({ "event": "hang_up", "call_id": call_id });
        if let Some(reason) = reason {
            command["reason"] = json!(reason);
        }
        self.send(&command).await
    }

    /// Close the control channel.
    pub async fn close(&mut self) -> Result<()> {
        self.transport.close().await
    }
}

/// Opens realtime control channels for the platform-hosted voice agent.
///
/// The streaming client is only compiled with the `tunnels-runtime` feature
/// (it reuses that feature's async runtime + WebSocket frame codec).
pub struct RealtimeResource {
    api_key: String,
    base_url: String,
}

impl RealtimeResource {
    pub(crate) fn new(api_key: String, base_url: String) -> Self {
        Self {
            api_key,
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    /// Open the control channel and subscribe.
    ///
    /// Provide exactly one of `call_id` (one live call) or `agent_identity_id`
    /// (all live + future calls for the identity).
    pub async fn connect(
        &self,
        call_id: Option<&str>,
        agent_identity_id: Option<&str>,
    ) -> Result<RealtimeControlSession> {
        if call_id.is_some() == agent_identity_id.is_some() {
            return Err(InkboxError::InvalidArgument(
                "pass exactly one of call_id or agent_identity_id".into(),
            ));
        }
        let url = self.control_url()?;
        let transport = WsTransport::connect(&url, &self.api_key).await?;
        let mut session = RealtimeControlSession { transport };
        let subscribe = subscribe_command(call_id, agent_identity_id);
        if let Err(err) = session.send(&subscribe).await {
            let _ = session.close().await;
            return Err(err);
        }
        Ok(session)
    }

    fn control_url(&self) -> Result<Url> {
        let mut url = Url::parse(&self.base_url)
            .map_err(|e| InkboxError::InvalidArgument(format!("invalid base url: {e}")))?;
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        url.set_scheme(scheme)
            .map_err(|_| InkboxError::InvalidArgument("cannot set ws scheme".into()))?;
        url.set_path(CONTROL_PATH);
        url.set_query(None);
        Ok(url)
    }
}

// ----- pure command builders (unit-tested) ---------------------------------

fn subscribe_command(call_id: Option<&str>, agent_identity_id: Option<&str>) -> Value {
    let mut command = json!({ "event": "subscribe" });
    if let Some(id) = call_id {
        command["call_id"] = json!(id);
    } else if let Some(id) = agent_identity_id {
        command["agent_identity_id"] = json!(id);
    }
    command
}

fn consult_answer_command(consult_id: &str, answer: &str, instructions: Option<&str>) -> Value {
    let mut command = json!({
        "event": "consult.answer",
        "consult_id": consult_id,
        "answer": answer,
    });
    if let Some(instructions) = instructions {
        command["instructions"] = json!(instructions);
    }
    command
}

fn inject_command(call_id: &str, mode: &str, text: &str) -> Value {
    json!({ "event": "inject", "call_id": call_id, "mode": mode, "text": text })
}

fn tool_decision_command(
    call_id: &str,
    tool_call_id: &str,
    decision: &str,
    reason: Option<&str>,
) -> Value {
    let mut command = json!({
        "event": "tool.decision",
        "call_id": call_id,
        "tool_call_id": tool_call_id,
        "decision": decision,
    });
    if let Some(reason) = reason {
        command["reason"] = json!(reason);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resource() -> RealtimeResource {
        RealtimeResource::new("sk-test".into(), "https://inkbox.ai".into())
    }

    #[test]
    fn control_url_derives_wss() {
        let url = resource().control_url().unwrap();
        assert_eq!(
            url.as_str(),
            "wss://inkbox.ai/api/v1/phone/ws/realtime-control"
        );
    }

    #[test]
    fn control_url_uses_ws_for_http_base() {
        let res = RealtimeResource::new("sk".into(), "http://localhost:8000".into());
        let url = res.control_url().unwrap();
        assert_eq!(url.scheme(), "ws");
        assert_eq!(url.host_str(), Some("localhost"));
        assert_eq!(url.port(), Some(8000));
    }

    #[tokio::test]
    async fn connect_rejects_ambiguous_target() {
        // Validation happens before any I/O, so no server is needed. Match on
        // the error without unwrapping the (non-Debug) session on the Ok arm.
        assert!(matches!(
            resource().connect(Some("c1"), Some("id")).await,
            Err(InkboxError::InvalidArgument(_))
        ));
        assert!(matches!(
            resource().connect(None, None).await,
            Err(InkboxError::InvalidArgument(_))
        ));
    }

    #[test]
    fn subscribe_command_targets_exactly_one() {
        assert_eq!(
            subscribe_command(Some("c1"), None),
            json!({ "event": "subscribe", "call_id": "c1" })
        );
        assert_eq!(
            subscribe_command(None, Some("id1")),
            json!({ "event": "subscribe", "agent_identity_id": "id1" })
        );
    }

    #[test]
    fn intervene_command_shapes() {
        assert_eq!(
            consult_answer_command("q1", "yes", Some("warm")),
            json!({ "event": "consult.answer", "consult_id": "q1",
                    "answer": "yes", "instructions": "warm" })
        );
        assert_eq!(
            consult_answer_command("q1", "yes", None),
            json!({ "event": "consult.answer", "consult_id": "q1", "answer": "yes" })
        );
        assert_eq!(
            inject_command("c1", "say", "hi"),
            json!({ "event": "inject", "call_id": "c1", "mode": "say", "text": "hi" })
        );
        assert_eq!(
            tool_decision_command("c1", "tc1", "approve", None),
            json!({ "event": "tool.decision", "call_id": "c1",
                    "tool_call_id": "tc1", "decision": "approve" })
        );
        assert_eq!(
            tool_decision_command("c1", "tc2", "deny", Some("nope")),
            json!({ "event": "tool.decision", "call_id": "c1", "tool_call_id": "tc2",
                    "decision": "deny", "reason": "nope" })
        );
    }
}
