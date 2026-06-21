//! Shared cookie parsing and matching for the blocking transport.
//!
//! A faithful port of `inkbox/_cookies.py`: a minimal RFC-6265-ish jar used so
//! the tunnels CSR-signing flow can carry server-set cookies across the
//! multi-request handshake. Not a general-purpose cookie store.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use url::Url;

#[derive(Debug, Clone)]
struct Cookie {
    name: String,
    value: String,
    domain: String,
    host_only: bool,
    path: String,
    secure: bool,
    /// Unix seconds; `None` means session cookie (no expiry).
    expires_at: Option<f64>,
}

/// Thread-safe cookie jar keyed by `(domain, path, name)`, matching the Python
/// dict keying so duplicate cookies overwrite rather than accumulate.
#[derive(Debug, Default)]
pub struct CookieJar {
    cookies: Mutex<HashMap<(String, String, String), Cookie>>,
}

fn now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

impl CookieJar {
    pub fn new() -> Self {
        Self::default()
    }

    /// Build the `Cookie:` header value for a request URL, dropping expired
    /// entries as a side effect. Returns `None` when nothing matches.
    pub fn header_for_url(&self, url: &str) -> Option<String> {
        let parsed = Url::parse(url).ok()?;
        let host = parsed.host_str().unwrap_or("").to_lowercase();
        let path = if parsed.path().is_empty() {
            "/"
        } else {
            parsed.path()
        };
        let is_secure = parsed.scheme() == "https";
        let now = now_secs();

        let mut jar = self.cookies.lock().unwrap();
        let mut expired: Vec<(String, String, String)> = Vec::new();
        let mut pairs: Vec<String> = Vec::new();

        for (key, cookie) in jar.iter() {
            if let Some(exp) = cookie.expires_at {
                if exp <= now {
                    expired.push(key.clone());
                    continue;
                }
            }
            if cookie.secure && !is_secure {
                continue;
            }
            if cookie.host_only {
                if host != cookie.domain {
                    continue;
                }
            } else if !domain_matches(&host, &cookie.domain) {
                continue;
            }
            if !path_matches(path, &cookie.path) {
                continue;
            }
            pairs.push(format!("{}={}", cookie.name, cookie.value));
        }

        for key in expired {
            jar.remove(&key);
        }

        if pairs.is_empty() {
            None
        } else {
            Some(pairs.join("; "))
        }
    }

    /// Ingest every `Set-Cookie` header from a response.
    pub fn store_from_headers<'a>(
        &self,
        url: &str,
        set_cookie_values: impl Iterator<Item = &'a str>,
    ) {
        for raw in set_cookie_values {
            if let Some(cookie) = parse_set_cookie(url, raw) {
                let key = (
                    cookie.domain.clone(),
                    cookie.path.clone(),
                    cookie.name.clone(),
                );
                if let Some(exp) = cookie.expires_at {
                    if exp <= now_secs() {
                        self.cookies.lock().unwrap().remove(&key);
                        continue;
                    }
                }
                self.cookies.lock().unwrap().insert(key, cookie);
            }
        }
    }
}

fn parse_set_cookie(url: &str, header: &str) -> Option<Cookie> {
    let parts: Vec<&str> = header
        .split(';')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    let first = parts.first()?;
    let (name, value) = first.split_once('=')?;
    if name.is_empty() {
        return None;
    }

    let parsed = Url::parse(url).ok()?;
    let mut domain = parsed.host_str().unwrap_or("").to_lowercase();
    let mut host_only = true;
    let mut path = default_path(if parsed.path().is_empty() {
        "/"
    } else {
        parsed.path()
    });
    let mut secure = false;
    let mut expires_at: Option<f64> = None;

    for attr in &parts[1..] {
        let (k, v) = match attr.split_once('=') {
            Some((k, v)) => (k.trim().to_lowercase(), v.trim().to_string()),
            None => (attr.trim().to_lowercase(), String::new()),
        };
        match k.as_str() {
            "domain" if !v.is_empty() => {
                domain = v.trim_start_matches('.').to_lowercase();
                host_only = false;
            }
            "path" if v.starts_with('/') => path = v,
            "secure" => secure = true,
            "max-age" => {
                if let Ok(secs) = v.parse::<i64>() {
                    expires_at = Some(now_secs() + secs as f64);
                }
            }
            "expires" if !v.is_empty() => {
                if let Some(ts) = parse_http_date(&v) {
                    expires_at = Some(ts);
                }
            }
            _ => {}
        }
    }

    Some(Cookie {
        name: name.to_string(),
        value: value.to_string(),
        domain,
        host_only,
        path,
        secure,
        expires_at,
    })
}

/// Best-effort RFC 1123 / asctime date parse to a Unix timestamp. The Python
/// SDK leans on `email.utils.parsedate_to_datetime`; we only need enough to
/// honour `Expires` on the handful of cookies the control plane sets.
fn parse_http_date(s: &str) -> Option<f64> {
    // Format: "Wdy, DD Mon YYYY HH:MM:SS GMT"
    let s = s.trim();
    let comma = s.find(',')?;
    let rest = s[comma + 1..].trim();
    let mut it = rest.split_whitespace();
    let day: i64 = it.next()?.parse().ok()?;
    let mon = month_num(it.next()?)?;
    let year: i64 = it.next()?.parse().ok()?;
    let time = it.next()?;
    let mut tparts = time.split(':');
    let hh: i64 = tparts.next()?.parse().ok()?;
    let mm: i64 = tparts.next()?.parse().ok()?;
    let ss: i64 = tparts.next()?.parse().ok()?;
    Some(days_from_civil(year, mon, day) as f64 * 86400.0 + (hh * 3600 + mm * 60 + ss) as f64)
}

fn month_num(m: &str) -> Option<i64> {
    Some(match m {
        "Jan" => 1,
        "Feb" => 2,
        "Mar" => 3,
        "Apr" => 4,
        "May" => 5,
        "Jun" => 6,
        "Jul" => 7,
        "Aug" => 8,
        "Sep" => 9,
        "Oct" => 10,
        "Nov" => 11,
        "Dec" => 12,
        _ => return None,
    })
}

/// Days since the Unix epoch for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn default_path(path: &str) -> String {
    if !path.starts_with('/') {
        return "/".to_string();
    }
    if path == "/" {
        return "/".to_string();
    }
    match path.rsplit_once('/') {
        Some((head, _)) if !head.is_empty() => head.to_string(),
        _ => "/".to_string(),
    }
}

fn domain_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

fn path_matches(request_path: &str, cookie_path: &str) -> bool {
    if request_path == cookie_path {
        return true;
    }
    if request_path.starts_with(cookie_path) {
        return cookie_path.ends_with('/')
            || request_path.as_bytes().get(cookie_path.len()) == Some(&b'/');
    }
    false
}
