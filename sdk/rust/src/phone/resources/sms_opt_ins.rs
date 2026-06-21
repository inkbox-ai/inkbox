//! SMS opt-in / opt-out registry (per-(org, receiver) consent state).
//!
//! Reads (`list`, `get`) are available to any admin or JWT caller. Writes
//! (`opt_in`, `opt_out`) are gated server-side to orgs that run their own
//! active, customer-managed 10DLC campaign — orgs on the Inkbox-default
//! campaign share consent state and can't override it through this API, so
//! those calls return an API error with a 409 status.

use std::sync::Arc;

use serde_json::Value;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::types::{SmsOptIn, SmsOptInStatus};

const BASE: &str = "/sms-opt-ins";

/// Build the opt-in path, optionally addressing one receiver and action.
fn path(receiver_number: Option<&str>, action: Option<&str>) -> String {
    match (receiver_number, action) {
        (None, _) => BASE.to_string(),
        (Some(num), None) => format!("{BASE}/{num}"),
        (Some(num), Some(act)) => format!("{BASE}/{num}/{act}"),
    }
}

/// Per-(org, receiver) SMS opt-in / opt-out state.
pub struct SmsOptInsResource {
    http: Arc<HttpTransport>,
}

impl SmsOptInsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List the calling org's SMS opt-in rows, newest-updated first.
    ///
    /// # Arguments
    /// * `status` - Filter to `opted_in` or `opted_out`. Omit for both.
    /// * `limit` - Max rows to return (1-200; server rejects values above 200).
    /// * `offset` - Number of rows to skip for pagination.
    pub fn list(
        &self,
        status: Option<SmsOptInStatus>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<SmsOptIn>> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(s) = status {
            params.push(("status", s.as_str().to_string()));
        }
        if let Some(l) = limit {
            params.push(("limit", l.to_string()));
        }
        if let Some(o) = offset {
            params.push(("offset", o.to_string()));
        }
        let data = self.http.get(&path(None, None), &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Get the opt-in row for one E.164 recipient.
    ///
    /// Returns an API error with status 404 if no row exists.
    pub fn get(&self, receiver_number: &str) -> Result<SmsOptIn> {
        let data = self
            .http
            .get(&path(Some(receiver_number), None), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Mark a recipient as opted in (admin-only, customer-campaign orgs only).
    ///
    /// Server records an audit event with `source=api`. Returns an API error
    /// with status 409 (error `customer_campaign_required`) when the calling
    /// org is on the Inkbox-default campaign rather than its own.
    pub fn opt_in(&self, receiver_number: &str) -> Result<SmsOptIn> {
        // POST with no body, matching the Python `self._http.post(path)`.
        let data = self.http.post(
            &path(Some(receiver_number), Some("opt-in")),
            None::<&Value>,
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Mark a recipient as opted out (admin-only, customer-campaign orgs only).
    ///
    /// Same auth + campaign gate as [`opt_in`](Self::opt_in).
    pub fn opt_out(&self, receiver_number: &str) -> Result<SmsOptIn> {
        let data = self.http.post(
            &path(Some(receiver_number), Some("opt-out")),
            None::<&Value>,
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }
}
