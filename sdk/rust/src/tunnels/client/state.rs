//! Hardened on-disk persistence for the tunnel state file (`tunnel_id`,
//! `name`, `mode`, `zone`, `public_host`) and for the passthrough keypair /
//! cert chain.
//!
//! Directory layout (matches the Python + TS SDKs so all three are
//! interoperable on disk):
//!
//! ```text
//! {state_dir}/
//!   state.json         # mode 0o600
//!   private_key.pem    # passthrough only, mode 0o600
//!   cert_chain.pem     # passthrough only, mode 0o600
//! ```
//!
//! Atomic writes via a temp file + `rename`. Initial file creation uses
//! `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` so a planted symlink can't trick the
//! SDK into clobbering an unrelated path. The `state_dir` itself is required
//! to NOT be a symlink (we `lstat` and refuse).
//!
//! Ported from `inkbox/tunnels/client/_state.py`.

use std::fs;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use serde_json::Value;

pub const STATE_FILE: &str = "state.json";
pub const KEY_FILE: &str = "private_key.pem";
pub const CERT_FILE: &str = "cert_chain.pem";

/// Raised when the state directory is unsafe to use (e.g. symlinked).
#[derive(Debug)]
pub struct TunnelStateError(pub String);

impl std::fmt::Display for TunnelStateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for TunnelStateError {}

/// Parsed contents of `state.json` (forward-compatible).
///
/// Pre-0.4.0 SDKs persisted the per-tunnel `connect_secret` here; the field
/// is ignored on read and never written. Data-plane authentication now uses
/// the client's API key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateEntry {
    pub tunnel_id: String,
    pub name: String,
    pub mode: Option<String>,
    pub zone: Option<String>,
    pub public_host: Option<String>,
}

impl StateEntry {
    /// Parse a raw JSON object, coercing fields with `str(...)` semantics.
    pub fn from_value(data: &Value) -> StateEntry {
        let s = |k: &str| -> String {
            match data.get(k) {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Null) | None => String::new(),
                Some(other) => other.to_string(),
            }
        };
        let opt = |k: &str| -> Option<String> {
            data.get(k).and_then(|v| v.as_str()).map(|s| s.to_string())
        };
        StateEntry {
            tunnel_id: s("tunnel_id"),
            name: s("name"),
            mode: opt("mode"),
            zone: opt("zone"),
            public_host: opt("public_host"),
        }
    }

    /// Serialize to the on-disk JSON shape (omitting `None` optionals,
    /// matching the Python `to_dict`).
    pub fn to_value(&self) -> Value {
        let mut out = serde_json::Map::new();
        out.insert("tunnel_id".into(), Value::String(self.tunnel_id.clone()));
        out.insert("name".into(), Value::String(self.name.clone()));
        if let Some(m) = &self.mode {
            out.insert("mode".into(), Value::String(m.clone()));
        }
        if let Some(z) = &self.zone {
            out.insert("zone".into(), Value::String(z.clone()));
        }
        if let Some(p) = &self.public_host {
            out.insert("public_host".into(), Value::String(p.clone()));
        }
        Value::Object(out)
    }
}

/// Create `state_dir` (mode 0o700) and refuse symlinked targets.
pub fn ensure_private_state_dir(state_dir: &Path) -> Result<(), TunnelStateError> {
    // If the path exists (or is a dangling symlink), refuse a symlink target.
    if let Ok(meta) = fs::symlink_metadata(state_dir) {
        if meta.file_type().is_symlink() {
            return Err(TunnelStateError(format!(
                "refusing to use a symlinked state_dir ({}); resolve and pass the real path",
                state_dir.display()
            )));
        }
    }
    fs::create_dir_all(state_dir)
        .map_err(|e| TunnelStateError(format!("could not create state_dir: {e}")))?;
    // Best-effort chmod to 0o700.
    let _ = set_mode(state_dir, 0o700);
    Ok(())
}

/// Read + parse `state.json`; return `None` on a missing / corrupt file.
pub fn load_state(state_dir: &Path) -> Option<StateEntry> {
    let state_path = state_dir.join(STATE_FILE);
    if !state_path.is_file() {
        return None;
    }
    let raw = fs::read_to_string(&state_path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    Some(StateEntry::from_value(&value))
}

/// Atomically write `state.json` (mode 0o600).
pub fn save_state(state_dir: &Path, entry: &StateEntry) -> Result<(), TunnelStateError> {
    ensure_private_state_dir(state_dir)?;
    let target = state_dir.join(STATE_FILE);
    // Match Python: `json.dumps(..., indent=2, sort_keys=True)`.
    let payload = to_pretty_sorted_json(&entry.to_value());
    atomic_write(&target, payload.as_bytes())
}

/// Atomically write a private file (mode 0o600).
///
/// First-create uses `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` to refuse following
/// a planted symlink; subsequent updates go through the standard
/// tempfile-then-rename atomic path.
pub fn write_private_file(target: &Path, content: &[u8]) -> Result<(), TunnelStateError> {
    let exists = fs::symlink_metadata(target).is_ok();
    if exists {
        return atomic_write(target, content);
    }
    let mut opts = fs::OpenOptions::new();
    opts.create_new(true)
        .write(true)
        .mode(0o600)
        // O_NOFOLLOW: refuse to follow a planted symlink on first create.
        .custom_flags(libc_o_nofollow());
    let mut f = opts
        .open(target)
        .map_err(|e| TunnelStateError(format!("could not create private file: {e}")))?;
    f.write_all(content)
        .map_err(|e| TunnelStateError(format!("write failed: {e}")))?;
    Ok(())
}

/// Atomic tempfile-then-rename write, mode 0o600.
fn atomic_write(target: &Path, content: &[u8]) -> Result<(), TunnelStateError> {
    let dir: PathBuf = target
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    // Unique temp name in the target directory (rename is atomic on the
    // same filesystem). Use pid + nanos like the TS port.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(".tmp-{}-{}", std::process::id(), nanos));
    let write_res = (|| -> std::io::Result<()> {
        let mut opts = fs::OpenOptions::new();
        opts.create_new(true).write(true).mode(0o600);
        let mut f = opts.open(&tmp)?;
        f.write_all(content)?;
        f.sync_all().ok();
        fs::rename(&tmp, target)
    })();
    match write_res {
        Ok(()) => {
            let _ = set_mode(target, 0o600);
            Ok(())
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(TunnelStateError(format!("atomic write failed: {e}")))
        }
    }
}

/// Set a file/dir's permission bits (POSIX). Best-effort.
fn set_mode(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

/// `O_NOFOLLOW` flag value. `std::os::unix` does not export it as a const,
/// so use the libc value (0o400000 on Linux). On platforms where this value
/// differs the create still succeeds — it just degrades the symlink guard,
/// matching the Python "best effort" posture.
fn libc_o_nofollow() -> i32 {
    // Linux/x86-64 + aarch64: O_NOFOLLOW == 0o400000.
    0o400000
}

/// Render JSON like Python's `json.dumps(obj, indent=2, sort_keys=True)`:
/// 2-space indent, keys sorted. `serde_json::to_value` already sorts when the
/// map is a `BTreeMap`-backed object built from `to_value`, but
/// `serde_json::Map` preserves insertion order, so sort explicitly here.
fn to_pretty_sorted_json(value: &Value) -> String {
    let sorted = sort_value(value);
    serde_json::to_string_pretty(&sorted).unwrap_or_else(|_| "{}".to_string())
}

/// Recursively sort object keys so output is deterministic + matches Python's
/// `sort_keys=True`.
fn sort_value(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted: std::collections::BTreeMap<String, Value> =
                std::collections::BTreeMap::new();
            for (k, v) in map {
                sorted.insert(k.clone(), sort_value(v));
            }
            Value::Object(sorted.into_iter().collect())
        }
        Value::Array(arr) => Value::Array(arr.iter().map(sort_value).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn unique_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("inkbox-tunnel-test-{tag}-{nanos}"))
    }

    // Mirrors test_save_and_load_state_roundtrip.
    #[test]
    fn save_and_load_roundtrip() {
        let entry = StateEntry {
            tunnel_id: "11111111-1111-1111-1111-111111111111".into(),
            name: "my-agent".into(),
            mode: Some("edge".into()),
            zone: Some("inkboxwire.com".into()),
            public_host: Some("my-agent.inkboxwire.com".into()),
        };
        let dir = unique_dir("roundtrip");
        save_state(&dir, &entry).unwrap();
        let loaded = load_state(&dir).unwrap();
        assert_eq!(loaded, entry);
        let _ = fs::remove_dir_all(&dir);
    }

    // Mirrors test_state_file_is_chmod_0600.
    #[test]
    fn state_file_is_chmod_0600() {
        let entry = StateEntry {
            tunnel_id: "abc".into(),
            name: "my-agent".into(),
            mode: Some("edge".into()),
            zone: None,
            public_host: None,
        };
        let dir = unique_dir("chmod");
        save_state(&dir, &entry).unwrap();
        save_state(&dir, &entry).unwrap(); // second write hits atomic path
        let meta = fs::metadata(dir.join(STATE_FILE)).unwrap();
        assert_eq!(meta.permissions().mode() & 0o777, 0o600);
        let _ = fs::remove_dir_all(&dir);
    }

    // Mirrors test_state_dir_mode_0700.
    #[test]
    fn state_dir_mode_0700() {
        let dir = unique_dir("dirmode");
        ensure_private_state_dir(&dir).unwrap();
        let meta = fs::metadata(&dir).unwrap();
        assert_eq!(meta.permissions().mode() & 0o777, 0o700);
        let _ = fs::remove_dir_all(&dir);
    }

    // Mirrors test_load_state_returns_none_for_missing.
    #[test]
    fn load_returns_none_for_missing() {
        assert!(load_state(&unique_dir("missing")).is_none());
    }

    // Mirrors test_load_state_returns_none_for_corrupt.
    #[test]
    fn load_returns_none_for_corrupt() {
        let dir = unique_dir("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(STATE_FILE), "not json{{{").unwrap();
        assert!(load_state(&dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    // Mirrors test_symlinked_state_dir_is_refused.
    #[test]
    fn symlinked_state_dir_is_refused() {
        let base = unique_dir("symlink");
        let real = base.join("real");
        let link = base.join("link");
        fs::create_dir_all(&real).unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(ensure_private_state_dir(&link).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    // Mirrors test_write_private_file_creates_with_0600.
    #[test]
    fn write_private_file_creates_with_0600() {
        let dir = unique_dir("privfile");
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("private.pem");
        write_private_file(&target, b"secret bytes").unwrap();
        let meta = fs::metadata(&target).unwrap();
        assert_eq!(meta.permissions().mode() & 0o777, 0o600);
        assert_eq!(fs::read(&target).unwrap(), b"secret bytes");
        let _ = fs::remove_dir_all(&dir);
    }
}
