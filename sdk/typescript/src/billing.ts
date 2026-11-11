import type { HttpTransport } from "./_http.js";

export type UsageAlertMetric = "identities" | "storage" | "sms" | "voice" | "overage";
export interface UsageAlertInput {
  metric: UsageAlertMetric; threshold: number; enabled?: boolean; mailbox_id?: string | null;
}
export interface UsageAlert extends UsageAlertInput {
  id: string; enabled: boolean; mailbox_id: string | null; is_default: boolean;
}

export interface CatalogRate {
  code: string; name: string; kind: string; unit: string; currency: string;
  published_amount: string; amount: string | null;
  pricing_state: "published" | "priced" | "not_billed" | "unknown";
}
export interface PricingResponse { prices: CatalogRate[] }
export interface CountryAgreement {
  id: string; name: string; country_codes: string[]; monthly_amount: string; currency: string;
  status: string; covered_through: string | null; cancel_at_period_end: boolean; change_pending: boolean; created_at: string;
}
export interface CallingCountry {
  country_code: string; name: string; monthly_amount: string; currency: string; status: string; agreement_id: string | null;
}
export interface CallingCountriesResponse {
  countries: CallingCountry[]; agreements: CountryAgreement[]; included_country_codes: string[];
}
export interface CountryQuoteLine {
  country_code: string; name: string; monthly_amount: string; amount_cents: number;
}
export interface CountryQuote {
  quote: string; expires_at: number; monthly_amount: string; country_amount_cents: number;
  invoice_total_cents: number; amount_due_cents: number; currency: string; renewal_at: number | null;
  items?: CountryQuoteLine[];
}

export type BundleCode = "voip_line_bundle" | "personal_imessage_line_bundle";
export interface BundleOffer {
  code: BundleCode; name: string; line_kind: "voip" | "imessage"; monthly_amount: string; voice_seconds: number; messages: number;
}
export interface BundleAgreement {
  id: string; code: BundleCode; name: string; line_kind: "voip" | "imessage"; monthly_amount: string;
  status: string; paid_through: string | null; cancel_at_period_end: boolean; change_pending: boolean;
}
export interface LineBundlesResponse {
  offers: BundleOffer[]; agreements: BundleAgreement[]; voice_seconds_remaining: number; messages_remaining: number;
}
export interface BundleQuote {
  code: BundleCode; name: string; quote: string; expires_at: number; monthly_amount: string;
  bundle_amount_cents: number; amount_due_cents: number; invoice_total_cents: number; currency: string;
  voice_seconds: number; messages: number; period_end: string;
}

export type IdentityPackStatus = "pending" | "requires_payment" | "active" | "canceling" | "suspended"
  | "canceled" | "expired" | "failed" | "review";
export interface IdentityPackOffer {
  code: string; name: string; monthly_amount: string; currency: string; identity_slots: number;
}
export interface IdentityPackAgreement {
  id: string; code: string; name: string; monthly_amount: string; currency: string; status: IdentityPackStatus;
  paid_through: string | null; cancel_at_period_end: boolean; change_pending: boolean; renewal_processing: boolean;
  payment_url: string | null; can_cancel: boolean; can_resume: boolean; created_at: string;
}
export interface IdentityPackCapacity {
  used: number; baseline: number; paid_slots: number; processing_slots: number; total: number;
  renewing_packs: number; paid_packs: number;
}
export interface IdentityPacksResponse {
  offer: IdentityPackOffer | null; agreements: IdentityPackAgreement[]; capacity: IdentityPackCapacity;
  mail_storage_bytes_per_identity: number; billing_account_available: boolean; payment_method_available: boolean;
  eligible: boolean; eligibility_reason: string | null; next_cursor: string | null;
}
export interface IdentityPackQuote {
  quote: string; expires_at: number; code: string; name: string; monthly_amount: string; currency: string;
  identity_slots: number; amount_due_cents: number; invoice_total_cents: number; pack_amount_cents: number;
  renewal_at: number | null; payment_mode: "quantity"; payment_method_available: boolean;
}
export interface IdentityPackMutationResponse {
  agreement_id: string; status: IdentityPackStatus; payment_url: string | null;
}

/** Organization-admin billing. Decimal amounts and response field names preserve the API representation. */
export class BillingResource {
  constructor(private readonly http: HttpTransport) {}
  usageAlerts(): Promise<UsageAlert[]> { return this.http.get("/billing/usage-alerts"); }
  saveUsageAlert(id: string, input: UsageAlertInput): Promise<UsageAlert> {
    const { metric, threshold, enabled, mailbox_id } = input;
    return this.http.put(`/billing/usage-alerts/${encodeURIComponent(id)}`, { metric, threshold, enabled, mailbox_id });
  }
  deleteUsageAlert(id: string): Promise<void> {
    return this.http.delete(`/billing/usage-alerts/${encodeURIComponent(id)}`);
  }
  pricing(): Promise<PricingResponse> { return this.http.get("/billing/pricing"); }
  callingCountries(): Promise<CallingCountriesResponse> { return this.http.get("/billing/calling-countries"); }
  quoteCountry(countryCode: string): Promise<CountryQuote> {
    return this.http.post("/billing/calling-countries/quote", { country_code: countryCode });
  }
  /** Confirm the charge; reuse requestKey after an uncertain response. */
  purchaseCountry(countryCode: string, options: { quote: string; requestKey: string }): Promise<CallingCountriesResponse> {
    return this.http.post("/billing/calling-countries", { country_code: countryCode, quote: options.quote, request_key: options.requestKey });
  }
  quoteCountries(countryCodes: string[]): Promise<CountryQuote> {
    return this.http.post("/billing/calling-countries/quote", { country_codes: countryCodes });
  }
  /** Pay once for all selected countries; retain requestKey for retries. */
  purchaseCountries(countryCodes: string[], options: { quote: string; requestKey: string }): Promise<CallingCountriesResponse> {
    return this.http.post("/billing/calling-countries", { country_codes: countryCodes, quote: options.quote, request_key: options.requestKey });
  }
  cancelCountry(agreementId: string): Promise<CallingCountriesResponse> {
    return this.http.post(`/billing/calling-countries/${encodeURIComponent(agreementId)}/cancel`, {});
  }
  resumeCountry(agreementId: string): Promise<CallingCountriesResponse> {
    return this.http.post(`/billing/calling-countries/${encodeURIComponent(agreementId)}/resume`, {});
  }
  lineBundles(): Promise<LineBundlesResponse> { return this.http.get("/billing/line-bundles"); }
  quoteLineBundle(code: BundleCode): Promise<BundleQuote> {
    return this.http.post("/billing/line-bundles/quote", { code });
  }
  /** Add capacity and prorated credits; reuse requestKey after an uncertain response. */
  purchaseLineBundle(code: BundleCode, options: { quote: string; requestKey: string }): Promise<LineBundlesResponse> {
    return this.http.post("/billing/line-bundles", { code, quote: options.quote, request_key: options.requestKey });
  }
  /** Remove an unused slot, retaining paid usage credits until expiry. */
  cancelLineBundle(agreementId: string): Promise<LineBundlesResponse> {
    return this.http.post(`/billing/line-bundles/${encodeURIComponent(agreementId)}/cancel`, {});
  }
  resumeLineBundle(agreementId: string): Promise<LineBundlesResponse> {
    return this.http.post(`/billing/line-bundles/${encodeURIComponent(agreementId)}/resume`, {});
  }
  /** Read one page of agreements and the organization's total identity capacity. */
  identityPacks(options: { cursor?: string; limit?: number } = {}): Promise<IdentityPacksResponse> {
    return this.http.get("/billing/identity-packs", options);
  }
  /** Preview an immediate prorated charge on the active paid plan's monthly cycle. */
  quoteIdentityPack(): Promise<IdentityPackQuote> {
    return this.http.post("/billing/identity-packs/quote", {});
  }
  /** Buy a prorated pack on an active paid plan; reuse the quote and UUID on retries. */
  purchaseIdentityPack(options: {
    quote: string; requestKey: string;
  }): Promise<IdentityPackMutationResponse> {
    return this.http.post("/billing/identity-packs", {
      quote: options.quote, request_key: options.requestKey,
    });
  }
  /** Stop only pack renewal, retaining paid capacity; reuse this action's UUID on retry. */
  cancelIdentityPack(agreementId: string, options: { requestKey: string }): Promise<IdentityPackMutationResponse> {
    return this.http.post(`/billing/identity-packs/${encodeURIComponent(agreementId)}/cancel`, { request_key: options.requestKey });
  }
  /** Resume before expiry on an active paid plan; retain this action's UUID on retries. */
  resumeIdentityPack(agreementId: string, options: { requestKey: string }): Promise<IdentityPackMutationResponse> {
    return this.http.post(`/billing/identity-packs/${encodeURIComponent(agreementId)}/resume`, { request_key: options.requestKey });
  }
}
