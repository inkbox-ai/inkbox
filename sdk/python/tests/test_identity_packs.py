"""Identity-pack client contracts and stable retry forwarding."""

import json
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

import httpx
import pytest

from inkbox import Inkbox
from inkbox.exceptions import InkboxAPIError


FIXTURE = json.loads(
    (Path(__file__).parents[3] / "tests/fixtures/identity_packs.json").read_text()
)
AGREEMENT_ID = UUID(FIXTURE["mutation"]["agreement_id"])
REQUEST_KEY = UUID("22222222-2222-4222-8222-222222222222")
RESUME_KEY = UUID("33333333-3333-4333-8333-333333333333")


def test_identity_pack_pagination_quote_and_payment_action() -> None:
    """Preserve pagination, quoted money, and outstanding payment actions."""
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        """Return the matching synthetic billing contract response."""
        requests.append(request)
        assert request.headers["X-API-Key"] == "synthetic-admin-key"
        if request.method == "GET":
            return httpx.Response(200, json=FIXTURE["list"])
        if request.url.path.endswith("/quote"):
            return httpx.Response(200, json=FIXTURE["quote"])
        return httpx.Response(202, json=FIXTURE["mutation"])

    with patch(
        "inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)
    ):
        with Inkbox(api_key="synthetic-admin-key") as client:
            assert client.billing.identity_packs() == FIXTURE["list"]
            assert (
                str(requests[0].url)
                == "https://inkbox.ai/api/v1/billing/identity-packs"
            )
            page = client.billing.identity_packs(cursor=AGREEMENT_ID, limit=1)
            assert dict(requests[1].url.params) == {
                "cursor": str(AGREEMENT_ID),
                "limit": "1",
            }
            assert page["agreements"][0]["paid_through"] is None
            assert page["capacity"]["total"] == 10
            quote = client.billing.quote_identity_pack()
            assert quote == FIXTURE["quote"]
            assert quote["monthly_amount"] == "100.00"
            assert quote["amount_due_cents"] == 5000
            assert quote["renewal_at"] == 2001209600
            assert quote["payment_mode"] == "quantity"
            assert requests[2].url.path == "/api/v1/billing/identity-packs/quote"
            assert json.loads(requests[2].content) == {}
            for _ in range(2):
                result = client.billing.purchase_identity_pack(
                    quote=quote["quote"],
                    request_key=REQUEST_KEY,
                )
                assert result == FIXTURE["mutation"]
                assert result["status"] == "requires_payment"
            assert requests[3].content == requests[4].content
            assert json.loads(requests[3].content) == {
                "quote": quote["quote"],
                "request_key": str(REQUEST_KEY),
            }
            client.billing.purchase_identity_pack(
                quote=quote["quote"], request_key=str(REQUEST_KEY)
            )
            assert json.loads(requests[5].content) == {
                "quote": quote["quote"],
                "request_key": str(REQUEST_KEY),
            }


def test_identity_pack_retry_after_uncertain_response_preserves_request() -> None:
    """Keep the original purchase payload after an interrupted response."""
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        """Interrupt only the original response to exercise caller retries."""
        requests.append(request)
        if len(requests) == 1:
            raise httpx.ReadTimeout("Response interrupted", request=request)
        return httpx.Response(202, json=FIXTURE["mutation"])

    with patch(
        "inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)
    ):
        with Inkbox(api_key="synthetic-admin-key") as client:
            with pytest.raises(httpx.ReadTimeout):
                client.billing.purchase_identity_pack(
                    quote="accepted", request_key=REQUEST_KEY
                )
            assert (
                client.billing.purchase_identity_pack(
                    quote="accepted", request_key=REQUEST_KEY
                )
                == FIXTURE["mutation"]
            )
    assert len(requests) == 2
    assert requests[0].content == requests[1].content


def test_identity_pack_cancel_resume_and_old_action_retry() -> None:
    """Forward each renewal action's original key on later retries."""
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        """Capture renewal actions without creating a payment request."""
        requests.append(request)
        return httpx.Response(
            202,
            json={**FIXTURE["mutation"], "status": "canceling", "payment_url": None},
        )

    with patch(
        "inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)
    ):
        with Inkbox(api_key="synthetic-admin-key") as client:
            for action, key in [
                ("cancel", REQUEST_KEY),
                ("resume", RESUME_KEY),
                ("cancel", REQUEST_KEY),
                ("resume", RESUME_KEY),
            ]:
                result = getattr(client.billing, f"{action}_identity_pack")(
                    AGREEMENT_ID, request_key=key
                )
                assert result["payment_url"] is None
                assert (
                    requests[-1].url.path
                    == f"/api/v1/billing/identity-packs/{AGREEMENT_ID}/{action}"
                )
                assert json.loads(requests[-1].content) == {"request_key": str(key)}
    assert requests[0].content == requests[2].content
    assert requests[1].content == requests[3].content


@pytest.mark.parametrize(
    "status,detail",
    [
        (401, "Invalid API key"),
        (403, "Organization-admin API key required"),
        (409, FIXTURE["conflict"]),
    ],
)
def test_identity_pack_errors_preserve_status_and_detail(
    status: int, detail: str | dict[str, object]
) -> None:
    """Retain actionable authentication and capacity-conflict errors."""

    def respond(request: httpx.Request) -> httpx.Response:
        """Return a synthetic error without hiding its structured details."""
        return httpx.Response(status, json={"detail": detail})

    with patch(
        "inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)
    ):
        with Inkbox(api_key="synthetic-key") as client:
            with pytest.raises(InkboxAPIError) as error:
                client.billing.cancel_identity_pack(
                    AGREEMENT_ID, request_key=REQUEST_KEY
                )
    assert error.value.status_code == status
    assert error.value.detail == detail


def test_identity_pack_unavailable_offer_and_last_page() -> None:
    """Preserve unavailable offers and explicit pagination completion."""
    payload = {
        **FIXTURE["list"],
        "offer": None,
        "agreements": [],
        "next_cursor": None,
        "eligible": False,
        "eligibility_reason": FIXTURE["paid_plan_required"],
    }
    with patch(
        "inkbox._http.httpx.HTTPTransport",
        return_value=httpx.MockTransport(
            lambda request: httpx.Response(200, json=payload)
        ),
    ):
        with Inkbox(api_key="synthetic-admin-key") as client:
            assert client.billing.identity_packs(cursor=AGREEMENT_ID) == payload


@pytest.mark.parametrize("action", ["quote", "purchase", "resume"])
def test_identity_pack_paid_plan_requirement_preserves_history_and_errors(
    action: str,
) -> None:
    """Retain existing agreements and surface paid-plan requirements without retries."""
    requests: list[httpx.Request] = []
    payload = {
        **FIXTURE["list"],
        "eligible": False,
        "eligibility_reason": FIXTURE["paid_plan_required"],
    }

    def respond(request: httpx.Request) -> httpx.Response:
        """Allow agreement reads and reject new billing actions."""
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=payload)
        return httpx.Response(409, json={"detail": FIXTURE["paid_plan_required"]})

    with patch(
        "inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)
    ):
        with Inkbox(api_key="synthetic-admin-key") as client:
            assert client.billing.identity_packs() == payload
            with pytest.raises(InkboxAPIError) as error:
                if action == "quote":
                    client.billing.quote_identity_pack()
                elif action == "purchase":
                    client.billing.purchase_identity_pack(
                        quote=FIXTURE["quote"]["quote"], request_key=REQUEST_KEY
                    )
                else:
                    client.billing.resume_identity_pack(
                        AGREEMENT_ID, request_key=RESUME_KEY
                    )
    assert error.value.status_code == 409
    assert error.value.detail == FIXTURE["paid_plan_required"]
    assert len(requests) == 2


@pytest.mark.parametrize("parameter", ["success_url", "cancel_url"])
def test_identity_pack_purchase_rejects_return_urls(parameter: str) -> None:
    """Reject return URLs before sending a purchase request."""
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        """Record any unexpected request."""
        requests.append(request)
        return httpx.Response(202, json=FIXTURE["mutation"])

    with patch(
        "inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)
    ):
        with Inkbox(api_key="synthetic-admin-key") as client:
            with pytest.raises(TypeError, match="unexpected keyword argument"):
                client.billing.purchase_identity_pack(
                    quote=FIXTURE["quote"]["quote"],
                    request_key=REQUEST_KEY,
                    **{parameter: "https://example.com/return"},
                )
    assert not requests
