from unittest.mock import MagicMock
from uuid import UUID

from inkbox.billing import BillingResource


def test_decimal_prices_and_retry_identity_are_preserved():
    http = MagicMock()
    resource = BillingResource(http)
    http.get.return_value = {"prices": [{"amount": "0.0005"}, {"amount": None}]}
    assert resource.pricing()["prices"] == [{"amount": "0.0005"}, {"amount": None}]
    key = UUID("a3f22fcb-d805-4811-830c-2c61c3da5316")
    for _ in range(2):
        resource.purchase_country("FR", quote="accepted", request_key=key)
    assert http.post.call_args_list[0] == http.post.call_args_list[1]
    assert http.post.call_args.kwargs["json"] == {"country_code": "FR", "quote": "accepted", "request_key": str(key)}


def test_cancel_and_resume_use_the_existing_agreement():
    http = MagicMock()
    resource = BillingResource(http)
    identifier = UUID("a3f22fcb-d805-4811-830c-2c61c3da5316")
    resource.cancel_country(identifier)
    assert http.post.call_args.args == (f"/billing/calling-countries/{identifier}/cancel",)
    resource.resume_country(identifier)
    assert http.post.call_args.args == (f"/billing/calling-countries/{identifier}/resume",)


def test_multiple_destinations_share_one_purchase_and_retry_identity():
    http = MagicMock()
    resource = BillingResource(http)
    countries = ["FR", "JP"]
    resource.quote_countries(countries)
    http.post.assert_called_once_with("/billing/calling-countries/quote", json={"country_codes": countries})
    http.post.reset_mock()
    key = UUID("a3f22fcb-d805-4811-830c-2c61c3da5316")
    for _ in range(2):
        resource.purchase_countries(countries, quote="accepted", request_key=key)
    assert http.post.call_args_list[0] == http.post.call_args_list[1]
    assert http.post.call_args.kwargs["json"] == {"country_codes": countries, "quote": "accepted", "request_key": str(key)}


def test_line_bundle_purchase_retry_and_lifecycle_paths():
    http = MagicMock()
    resource = BillingResource(http)
    resource.line_bundles()
    http.get.assert_called_with("/billing/line-bundles")
    resource.quote_line_bundle("personal_imessage_line_bundle")
    http.post.assert_called_with("/billing/line-bundles/quote", json={"code":"personal_imessage_line_bundle"})
    key = UUID("a3f22fcb-d805-4811-830c-2c61c3da5316")
    for _ in range(2):
        resource.purchase_line_bundle("voip_line_bundle", quote="accepted", request_key=key)
    assert http.post.call_args_list[-1] == http.post.call_args_list[-2]
    resource.cancel_line_bundle(key)
    assert http.post.call_args.args == (f"/billing/line-bundles/{key}/cancel",)
    resource.resume_line_bundle(key)
    assert http.post.call_args.args == (f"/billing/line-bundles/{key}/resume",)


def test_usage_alert_disable_and_restore_default():
    http = MagicMock()
    resource = BillingResource(http)
    rule_id = UUID("a3f22fcb-d805-4811-830c-2c61c3da5316")
    http.get.return_value = [{"id": str(rule_id), "is_default": True, "threshold": 90}]
    assert resource.usage_alerts()[0]["is_default"]
    resource.save_usage_alert(rule_id, metric="identities", threshold=90, enabled=False)
    http.put.assert_called_once_with(f"/billing/usage-alerts/{rule_id}", json={
        "metric": "identities", "threshold": 90, "enabled": False, "mailbox_id": None,
    })
    resource.delete_usage_alert(rule_id)
    http.delete.assert_called_once_with(f"/billing/usage-alerts/{rule_id}")
