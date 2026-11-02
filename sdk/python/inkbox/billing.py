"""Organization-admin pricing and add-on subscriptions."""

from typing import TYPE_CHECKING, Literal, NotRequired, TypedDict, cast
from uuid import UUID

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class CatalogRate(TypedDict):
    code: str
    name: str
    kind: str
    unit: str
    currency: str
    published_amount: str
    amount: str | None
    pricing_state: Literal["published", "priced", "not_billed", "unknown"]


class PricingResponse(TypedDict):
    prices: list[CatalogRate]


class CountryAgreement(TypedDict):
    id: str
    name: str
    country_codes: list[str]
    monthly_amount: str
    currency: str
    status: str
    covered_through: str | None
    cancel_at_period_end: bool
    change_pending: bool
    created_at: str


class CallingCountry(TypedDict):
    country_code: str
    name: str
    monthly_amount: str
    currency: str
    status: str
    agreement_id: str | None


class CallingCountriesResponse(TypedDict):
    countries: list[CallingCountry]
    agreements: list[CountryAgreement]
    included_country_codes: list[str]


class CountryQuoteLine(TypedDict):
    country_code: str
    name: str
    monthly_amount: str
    amount_cents: int


class CountryQuote(TypedDict):
    quote: str
    expires_at: int
    monthly_amount: str
    country_amount_cents: int
    invoice_total_cents: int
    amount_due_cents: int
    currency: str
    renewal_at: int | None
    items: NotRequired[list[CountryQuoteLine]]


BundleCode = Literal["voip_line_bundle", "personal_imessage_line_bundle"]


class BundleOffer(TypedDict):
    code: BundleCode
    name: str
    line_kind: Literal["voip", "imessage"]
    monthly_amount: str
    voice_seconds: int
    messages: int


class BundleAgreement(TypedDict):
    id: str
    code: BundleCode
    name: str
    line_kind: Literal["voip", "imessage"]
    monthly_amount: str
    status: str
    paid_through: str | None
    cancel_at_period_end: bool
    change_pending: bool


class LineBundlesResponse(TypedDict):
    offers: list[BundleOffer]
    agreements: list[BundleAgreement]
    voice_seconds_remaining: int
    messages_remaining: int


class BundleQuote(TypedDict):
    quote: str
    expires_at: int
    code: BundleCode
    name: str
    monthly_amount: str
    bundle_amount_cents: int
    amount_due_cents: int
    invoice_total_cents: int
    currency: str
    voice_seconds: int
    messages: int
    period_end: str


IdentityPackStatus = Literal[
    "pending", "requires_payment", "active", "canceling", "suspended",
    "canceled", "expired", "failed", "review",
]


class IdentityPackOffer(TypedDict):
    code: str
    name: str
    monthly_amount: str
    currency: str
    identity_slots: int


class IdentityPackAgreement(TypedDict):
    id: str
    code: str
    name: str
    monthly_amount: str
    currency: str
    status: IdentityPackStatus
    paid_through: str | None
    cancel_at_period_end: bool
    change_pending: bool
    renewal_processing: bool
    payment_url: str | None
    can_cancel: bool
    can_resume: bool
    created_at: str


class IdentityPackCapacity(TypedDict):
    used: int
    baseline: int
    paid_slots: int
    processing_slots: int
    total: int
    renewing_packs: int
    paid_packs: int


class IdentityPacksResponse(TypedDict):
    offer: IdentityPackOffer | None
    agreements: list[IdentityPackAgreement]
    capacity: IdentityPackCapacity
    mail_storage_bytes_per_identity: int
    billing_account_available: bool
    payment_method_available: bool
    eligible: bool
    eligibility_reason: str | None
    next_cursor: str | None


class IdentityPackQuote(TypedDict):
    quote: str
    expires_at: int
    code: str
    name: str
    monthly_amount: str
    currency: str
    identity_slots: int
    amount_due_cents: int
    invoice_total_cents: int
    pack_amount_cents: int
    renewal_at: int | None
    payment_mode: Literal["checkout", "saved_card", "quantity"]
    payment_method_available: bool


class IdentityPackMutationResponse(TypedDict):
    agreement_id: str
    status: IdentityPackStatus
    payment_url: str | None


class BillingResource:
    """Requires an organization-admin API key; identity-scoped keys cannot purchase."""

    def __init__(self, http: "HttpTransport") -> None:
        self._http = http

    def pricing(self) -> PricingResponse:
        return cast(PricingResponse, self._http.get("/billing/pricing"))

    def calling_countries(self) -> CallingCountriesResponse:
        return cast(CallingCountriesResponse, self._http.get("/billing/calling-countries"))

    def quote_country(self, country_code: str) -> CountryQuote:
        return cast(CountryQuote, self._http.post("/billing/calling-countries/quote", json={"country_code": country_code}))

    def purchase_country(self, country_code: str, *, quote: str, request_key: UUID | str) -> CallingCountriesResponse:
        """Confirm the quoted charge. Reuse request_key when retrying an uncertain result."""
        return cast(CallingCountriesResponse, self._http.post("/billing/calling-countries", json={
            "country_code": country_code, "quote": quote, "request_key": str(request_key),
        }))

    def quote_countries(self, country_codes: list[str]) -> CountryQuote:
        """Preview one invoice for all selected destinations."""
        return cast(CountryQuote, self._http.post("/billing/calling-countries/quote", json={"country_codes": country_codes}))

    def purchase_countries(self, country_codes: list[str], *, quote: str, request_key: UUID | str) -> CallingCountriesResponse:
        """Pay once for the selection; reuse request_key after an uncertain response."""
        return cast(CallingCountriesResponse, self._http.post("/billing/calling-countries", json={
            "country_codes": country_codes, "quote": quote, "request_key": str(request_key),
        }))

    def cancel_country(self, agreement_id: UUID | str) -> CallingCountriesResponse:
        """Stop renewal while retaining access through the paid-through date."""
        return cast(CallingCountriesResponse, self._http.post(f"/billing/calling-countries/{UUID(str(agreement_id))}/cancel", json={}))

    def resume_country(self, agreement_id: UUID | str) -> CallingCountriesResponse:
        return cast(CallingCountriesResponse, self._http.post(f"/billing/calling-countries/{UUID(str(agreement_id))}/resume", json={}))

    def line_bundles(self) -> LineBundlesResponse:
        return cast(LineBundlesResponse, self._http.get("/billing/line-bundles"))

    def quote_line_bundle(self, code: BundleCode) -> BundleQuote:
        return cast(BundleQuote, self._http.post("/billing/line-bundles/quote", json={"code": code}))

    def purchase_line_bundle(self, code: BundleCode, *, quote: str, request_key: UUID | str) -> LineBundlesResponse:
        """Add capacity and prorated credits; reuse request_key after an uncertain result."""
        return cast(LineBundlesResponse, self._http.post("/billing/line-bundles", json={
            "code": code, "quote": quote, "request_key": str(request_key),
        }))

    def cancel_line_bundle(self, agreement_id: UUID | str) -> LineBundlesResponse:
        """Remove an unused slot and stop renewal; retain paid usage credits until expiry."""
        return cast(LineBundlesResponse, self._http.post(f"/billing/line-bundles/{UUID(str(agreement_id))}/cancel", json={}))

    def resume_line_bundle(self, agreement_id: UUID | str) -> LineBundlesResponse:
        return cast(LineBundlesResponse, self._http.post(f"/billing/line-bundles/{UUID(str(agreement_id))}/resume", json={}))

    def identity_packs(self, *, cursor: UUID | str | None = None, limit: int | None = None) -> IdentityPacksResponse:
        """Read one page of agreements and the organization's total identity capacity."""
        return cast(IdentityPacksResponse, self._http.get("/billing/identity-packs", params={
            "cursor": str(cursor) if cursor is not None else None, "limit": limit,
        }))

    def quote_identity_pack(self) -> IdentityPackQuote:
        """Preview the charge for one pack without purchasing it."""
        return cast(IdentityPackQuote, self._http.post("/billing/identity-packs/quote", json={}))

    def purchase_identity_pack(
        self, *, quote: str, request_key: UUID | str,
        success_url: str | None = None, cancel_url: str | None = None,
    ) -> IdentityPackMutationResponse:
        """Reuse the same quote and request UUID on retry; acceptance is not payment confirmation."""
        body = {"quote": quote, "request_key": str(request_key)}
        if success_url is not None:
            body["success_url"] = success_url
        if cancel_url is not None:
            body["cancel_url"] = cancel_url
        return cast(IdentityPackMutationResponse, self._http.post("/billing/identity-packs", json=body))

    def cancel_identity_pack(self, agreement_id: UUID | str, *, request_key: UUID | str) -> IdentityPackMutationResponse:
        """Stop renewal, retaining paid capacity. Reuse this action's UUID on retry."""
        return cast(IdentityPackMutationResponse, self._http.post(
            f"/billing/identity-packs/{UUID(str(agreement_id))}/cancel", json={"request_key": str(request_key)},
        ))

    def resume_identity_pack(self, agreement_id: UUID | str, *, request_key: UUID | str) -> IdentityPackMutationResponse:
        """Resume renewal before expiry. Use a new UUID for this action, retaining it on retry."""
        return cast(IdentityPackMutationResponse, self._http.post(
            f"/billing/identity-packs/{UUID(str(agreement_id))}/resume", json={"request_key": str(request_key)},
        ))
