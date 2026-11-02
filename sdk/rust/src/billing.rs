//! Organization-admin prices and add-on subscriptions.

use crate::error::Result;
use crate::http::{HttpTransport, NO_QUERY};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CatalogRate {
    pub code: String,
    pub name: String,
    pub kind: String,
    pub unit: String,
    pub currency: String,
    pub published_amount: String,
    pub amount: Option<String>,
    pub pricing_state: String,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PricingResponse {
    pub prices: Vec<CatalogRate>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CountryAgreement {
    pub id: Uuid,
    pub name: String,
    pub country_codes: Vec<String>,
    pub monthly_amount: String,
    pub currency: String,
    pub status: String,
    pub covered_through: Option<String>,
    pub cancel_at_period_end: bool,
    pub change_pending: bool,
    pub created_at: String,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CallingCountry {
    pub country_code: String,
    pub name: String,
    pub monthly_amount: String,
    pub currency: String,
    pub status: String,
    pub agreement_id: Option<Uuid>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CallingCountriesResponse {
    pub countries: Vec<CallingCountry>,
    pub agreements: Vec<CountryAgreement>,
    pub included_country_codes: Vec<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CountryQuoteLine {
    pub country_code: String,
    pub name: String,
    pub monthly_amount: String,
    pub amount_cents: i64,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CountryQuote {
    pub quote: String,
    pub expires_at: i64,
    pub monthly_amount: String,
    pub country_amount_cents: i64,
    pub invoice_total_cents: i64,
    pub amount_due_cents: i64,
    pub currency: String,
    pub renewal_at: Option<i64>,
    #[serde(default)]
    pub items: Vec<CountryQuoteLine>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BundleCode {
    VoipLineBundle,
    PersonalImessageLineBundle,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BundleOffer {
    pub code: BundleCode,
    pub name: String,
    pub line_kind: String,
    pub monthly_amount: String,
    pub voice_seconds: i64,
    pub messages: i64,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BundleAgreement {
    pub id: Uuid,
    pub code: BundleCode,
    pub name: String,
    pub line_kind: String,
    pub monthly_amount: String,
    pub status: String,
    pub paid_through: Option<String>,
    pub cancel_at_period_end: bool,
    pub change_pending: bool,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LineBundlesResponse {
    pub offers: Vec<BundleOffer>,
    pub agreements: Vec<BundleAgreement>,
    pub voice_seconds_remaining: i64,
    pub messages_remaining: i64,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BundleQuote {
    pub code: BundleCode,
    pub name: String,
    pub quote: String,
    pub expires_at: i64,
    pub monthly_amount: String,
    pub bundle_amount_cents: i64,
    pub amount_due_cents: i64,
    pub invoice_total_cents: i64,
    pub currency: String,
    pub voice_seconds: i64,
    pub messages: i64,
    pub period_end: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IdentityPackStatus {
    Pending,
    RequiresPayment,
    Active,
    Canceling,
    Suspended,
    Canceled,
    Expired,
    Failed,
    Review,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct IdentityPackOffer {
    pub code: String,
    pub name: String,
    pub monthly_amount: String,
    pub currency: String,
    pub identity_slots: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct IdentityPackAgreement {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub monthly_amount: String,
    pub currency: String,
    pub status: IdentityPackStatus,
    pub paid_through: Option<String>,
    pub cancel_at_period_end: bool,
    pub change_pending: bool,
    pub renewal_processing: bool,
    pub payment_url: Option<String>,
    pub can_cancel: bool,
    pub can_resume: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct IdentityPackCapacity {
    pub used: i64,
    pub baseline: i64,
    pub paid_slots: i64,
    pub processing_slots: i64,
    pub total: i64,
    pub renewing_packs: i64,
    pub paid_packs: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct IdentityPacksResponse {
    pub offer: Option<IdentityPackOffer>,
    pub agreements: Vec<IdentityPackAgreement>,
    pub capacity: IdentityPackCapacity,
    pub mail_storage_bytes_per_identity: i64,
    pub billing_account_available: bool,
    pub payment_method_available: bool,
    pub eligible: bool,
    pub eligibility_reason: Option<String>,
    pub next_cursor: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IdentityPackPaymentMode {
    Checkout,
    SavedCard,
    Quantity,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct IdentityPackQuote {
    pub quote: String,
    pub expires_at: i64,
    pub code: String,
    pub name: String,
    pub monthly_amount: String,
    pub currency: String,
    pub identity_slots: i64,
    pub amount_due_cents: i64,
    pub invoice_total_cents: i64,
    pub pack_amount_cents: i64,
    pub renewal_at: Option<i64>,
    pub payment_mode: IdentityPackPaymentMode,
    pub payment_method_available: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct IdentityPackMutationResponse {
    pub agreement_id: Uuid,
    pub status: IdentityPackStatus,
    pub payment_url: Option<String>,
}

pub struct BillingResource {
    http: Arc<HttpTransport>,
}
impl BillingResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }
    pub fn pricing(&self) -> Result<PricingResponse> {
        Ok(serde_json::from_value(
            self.http.get("/billing/pricing", NO_QUERY)?,
        )?)
    }
    pub fn calling_countries(&self) -> Result<CallingCountriesResponse> {
        Ok(serde_json::from_value(
            self.http.get("/billing/calling-countries", NO_QUERY)?,
        )?)
    }
    pub fn quote_country(&self, country_code: &str) -> Result<CountryQuote> {
        Ok(serde_json::from_value(self.http.post(
            "/billing/calling-countries/quote",
            Some(&json!({"country_code": country_code})),
            NO_QUERY,
        )?)?)
    }
    /// Confirm the charge, retaining request_key for any retry after an uncertain result.
    pub fn purchase_country(
        &self,
        country_code: &str,
        quote: &str,
        request_key: Uuid,
    ) -> Result<CallingCountriesResponse> {
        Ok(serde_json::from_value(self.http.post(
            "/billing/calling-countries",
            Some(&json!({
                "country_code": country_code, "quote": quote, "request_key": request_key
            })),
            NO_QUERY,
        )?)?)
    }
    pub fn quote_countries(&self, country_codes: &[&str]) -> Result<CountryQuote> {
        Ok(serde_json::from_value(self.http.post(
            "/billing/calling-countries/quote",
            Some(&json!({"country_codes": country_codes})),
            NO_QUERY,
        )?)?)
    }
    /// Pay once for the selection, retaining request_key for retries.
    pub fn purchase_countries(
        &self,
        country_codes: &[&str],
        quote: &str,
        request_key: Uuid,
    ) -> Result<CallingCountriesResponse> {
        Ok(serde_json::from_value(self.http.post(
            "/billing/calling-countries",
            Some(&json!({"country_codes": country_codes, "quote": quote, "request_key": request_key})),
            NO_QUERY,
        )?)?)
    }
    pub fn cancel_country(&self, agreement_id: Uuid) -> Result<CallingCountriesResponse> {
        Ok(serde_json::from_value(self.http.post(
            &format!("/billing/calling-countries/{agreement_id}/cancel"),
            Some(&json!({})),
            NO_QUERY,
        )?)?)
    }
    pub fn resume_country(&self, agreement_id: Uuid) -> Result<CallingCountriesResponse> {
        Ok(serde_json::from_value(self.http.post(
            &format!("/billing/calling-countries/{agreement_id}/resume"),
            Some(&json!({})),
            NO_QUERY,
        )?)?)
    }
    pub fn line_bundles(&self) -> Result<LineBundlesResponse> {
        Ok(serde_json::from_value(
            self.http.get("/billing/line-bundles", NO_QUERY)?,
        )?)
    }
    pub fn quote_line_bundle(&self, code: BundleCode) -> Result<BundleQuote> {
        Ok(serde_json::from_value(self.http.post(
            "/billing/line-bundles/quote",
            Some(&json!({"code":code})),
            NO_QUERY,
        )?)?)
    }
    /// Reuse request_key after an uncertain result to avoid another purchase.
    pub fn purchase_line_bundle(
        &self,
        code: BundleCode,
        quote: &str,
        request_key: Uuid,
    ) -> Result<LineBundlesResponse> {
        Ok(serde_json::from_value(self.http.post(
            "/billing/line-bundles",
            Some(&json!({"code":code,"quote":quote,"request_key":request_key})),
            NO_QUERY,
        )?)?)
    }
    /// Remove an unused slot; paid usage credits remain until expiry.
    pub fn cancel_line_bundle(&self, agreement_id: Uuid) -> Result<LineBundlesResponse> {
        Ok(serde_json::from_value(self.http.post(
            &format!("/billing/line-bundles/{agreement_id}/cancel"),
            Some(&json!({})),
            NO_QUERY,
        )?)?)
    }
    pub fn resume_line_bundle(&self, agreement_id: Uuid) -> Result<LineBundlesResponse> {
        Ok(serde_json::from_value(self.http.post(
            &format!("/billing/line-bundles/{agreement_id}/resume"),
            Some(&json!({})),
            NO_QUERY,
        )?)?)
    }

    /// Read one page of agreements and the organization's total identity capacity.
    pub fn identity_packs(
        &self,
        cursor: Option<Uuid>,
        limit: Option<u32>,
    ) -> Result<IdentityPacksResponse> {
        let mut params = Vec::new();
        if let Some(cursor) = cursor {
            params.push(("cursor", cursor.to_string()));
        }
        if let Some(limit) = limit {
            params.push(("limit", limit.to_string()));
        }
        Ok(serde_json::from_value(
            self.http.get("/billing/identity-packs", &params)?,
        )?)
    }

    pub fn quote_identity_pack(&self) -> Result<IdentityPackQuote> {
        Ok(serde_json::from_value(self.http.post(
            "/billing/identity-packs/quote",
            Some(&json!({})),
            NO_QUERY,
        )?)?)
    }

    /// Reuse the quote and request UUID on retry; acceptance is not payment confirmation.
    pub fn purchase_identity_pack(
        &self,
        quote: &str,
        request_key: Uuid,
        success_url: Option<&str>,
        cancel_url: Option<&str>,
    ) -> Result<IdentityPackMutationResponse> {
        let mut body = json!({"quote": quote, "request_key": request_key});
        if let Some(url) = success_url {
            body["success_url"] = json!(url);
        }
        if let Some(url) = cancel_url {
            body["cancel_url"] = json!(url);
        }
        Ok(serde_json::from_value(self.http.post(
            "/billing/identity-packs",
            Some(&body),
            NO_QUERY,
        )?)?)
    }

    /// Stop renewal, retaining paid capacity. Reuse this action's UUID on retry.
    pub fn cancel_identity_pack(
        &self,
        agreement_id: Uuid,
        request_key: Uuid,
    ) -> Result<IdentityPackMutationResponse> {
        Ok(serde_json::from_value(self.http.post(
            &format!("/billing/identity-packs/{agreement_id}/cancel"),
            Some(&json!({"request_key": request_key})),
            NO_QUERY,
        )?)?)
    }

    /// Resume before expiry. Use a new UUID for this action, retaining it on retry.
    pub fn resume_identity_pack(
        &self,
        agreement_id: Uuid,
        request_key: Uuid,
    ) -> Result<IdentityPackMutationResponse> {
        Ok(serde_json::from_value(self.http.post(
            &format!("/billing/identity-packs/{agreement_id}/resume"),
            Some(&json!({"request_key": request_key})),
            NO_QUERY,
        )?)?)
    }
}
