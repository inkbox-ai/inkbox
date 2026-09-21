//! Optional advisory metadata, independent of API success and error payloads.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ResponseNotice {
    pub code: String,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResponseMetadata {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_notices"
    )]
    pub notices: Option<Vec<ResponseNotice>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIResponse<T> {
    pub data: T,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_notices"
    )]
    pub notices: Option<Vec<ResponseNotice>>,
}

pub type ResponseObserver = Arc<dyn Fn(&ResponseMetadata) + Send + Sync>;

pub(crate) fn notices(value: &serde_json::Value) -> Option<Vec<ResponseNotice>> {
    let mut result = Vec::new();
    for item in value.as_array()? {
        if let Ok(notice) = serde_json::from_value::<ResponseNotice>(item.clone()) {
            if !result.contains(&notice) {
                result.push(notice);
            }
        }
    }
    (!result.is_empty()).then_some(result)
}

pub(crate) fn deserialize_notices<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<ResponseNotice>>, D::Error> {
    Ok(notices(&serde_json::Value::deserialize(d)?))
}

#[derive(Clone, Default)]
pub(crate) struct ResponseContext {
    pub observer: Option<ResponseObserver>,
    pub collector: Option<Arc<Mutex<Vec<ResponseNotice>>>>,
}

impl std::fmt::Debug for ResponseContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResponseContext").finish_non_exhaustive()
    }
}

impl ResponseContext {
    pub fn observe(&self, metadata: ResponseMetadata) {
        if let (Some(collector), Some(notices)) = (&self.collector, &metadata.notices) {
            let mut collected = collector.lock().unwrap_or_else(|e| e.into_inner());
            for notice in notices {
                if !collected.contains(notice) {
                    collected.push(notice.clone());
                }
            }
        }
        if let Some(observer) = &self.observer {
            // A callback panic must never turn a completed write into a retryable failure.
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| observer(&metadata)));
        }
    }
}

/// Only these response contracts declare top-level notice metadata.
pub(crate) fn declares_body_metadata(url: &str, method: &reqwest::Method) -> bool {
    let Ok(url) = url::Url::parse(url) else {
        return false;
    };
    let path: Vec<_> = url.path().trim_matches('/').split('/').collect();
    if matches!(path.as_slice(), ["api", "v1", "identities", _, "avatar"]) {
        return method == reqwest::Method::PUT;
    }
    matches!(
        path.as_slice(),
        ["api", "v1", "identities"]
            | ["api", "v1", "identities", _]
            | ["api", "v1", "identities", _, "companion"]
            | [
                "api",
                "v1",
                "identities",
                _,
                "companion",
                "activations",
                _,
                "messages"
            ]
            | [
                "api",
                "v1",
                "identities",
                _,
                "contacts",
                _,
                "access" | "permissions"
            ]
            | [
                "api",
                "v1",
                "identities",
                _,
                "contact-permissions" | "contact-communication-policies"
            ]
            | [
                "api",
                "v1",
                "contacts",
                _,
                "communication-policy" | "communication-preview"
            ]
            | ["api", "v1", "mail", "mailboxes", _]
            | ["api", "v1", "phone", "numbers", _]
    )
}
