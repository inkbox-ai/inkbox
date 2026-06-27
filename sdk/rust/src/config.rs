//! Resolve client settings from explicit args, then env vars, then the
//! `~/.inkbox/config` file. Background / agent processes often don't inherit
//! the shell's env, so a file fallback is handy.
//!
//! The config file is a simple `key = value` text file: one pair per line,
//! `#` comments and blank lines ignored, surrounding quotes stripped. Same
//! format the Python SDK and CLI read.

use std::collections::HashMap;
use std::path::PathBuf;

fn config_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".inkbox").join("config"))
}

fn read_config_file() -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Some(path) = config_path() else {
        return out;
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return out;
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        out.insert(key.trim().to_string(), value.to_string());
    }
    out
}

/// Resolve `(api_key, base_url, vault_key)`: explicit arg → env var → file.
pub fn resolve_client_settings(
    api_key: Option<String>,
    base_url: Option<String>,
    vault_key: Option<String>,
) -> (Option<String>, Option<String>, Option<String>) {
    let mut file: Option<HashMap<String, String>> = None;
    let mut pick = |explicit: Option<String>, env: &str, key: &str| -> Option<String> {
        if explicit.is_some() {
            return explicit;
        }
        if let Ok(value) = std::env::var(env) {
            if !value.is_empty() {
                return Some(value);
            }
        }
        file.get_or_insert_with(read_config_file).get(key).cloned()
    };
    (
        pick(api_key, "INKBOX_API_KEY", "api_key"),
        pick(base_url, "INKBOX_BASE_URL", "base_url"),
        pick(vault_key, "INKBOX_VAULT_KEY", "vault_key"),
    )
}
