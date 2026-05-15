"""
sdk/python/tests/test_sms_opt_ins.py

Tests for ``SmsOptInsResource`` (Python SDK).
"""

from unittest.mock import MagicMock
from uuid import UUID

import pytest

from inkbox.phone.resources.sms_opt_ins import SmsOptInsResource
from inkbox.phone.types import SmsOptInSource, SmsOptInStatus


OPT_IN_DICT = {
    "id": "aaaa1111-0000-0000-0000-000000000020",
    "organization_id": "org_test",
    "receiver_number": "+15551234567",
    "status": "opted_in",
    "source": "customer_api",
    "opted_in_at": "2026-05-15T12:00:00Z",
    "opted_out_at": None,
    "created_at": "2026-05-15T12:00:00Z",
    "updated_at": "2026-05-15T12:00:00Z",
}

OPT_OUT_DICT = {
    **OPT_IN_DICT,
    "id": "aaaa1111-0000-0000-0000-000000000021",
    "status": "opted_out",
    "source": "sms",
    "opted_in_at": None,
    "opted_out_at": "2026-05-15T12:05:00Z",
}


@pytest.fixture
def transport():
    t = MagicMock()
    t.get = MagicMock()
    t.post = MagicMock()
    return t


class TestSmsOptInsResource:
    def test_list_with_filters(self, transport):
        transport.get.return_value = [OPT_IN_DICT, OPT_OUT_DICT]
        resource = SmsOptInsResource(transport)

        rows = resource.list(status=SmsOptInStatus.OPTED_OUT, limit=10, offset=5)

        transport.get.assert_called_once_with(
            "/sms-opt-ins",
            params={"status": "opted_out", "limit": 10, "offset": 5},
        )
        assert len(rows) == 2
        assert rows[0].status is SmsOptInStatus.OPTED_IN
        assert rows[0].source is SmsOptInSource.CUSTOMER_API
        assert rows[0].opted_out_at is None
        assert rows[1].status is SmsOptInStatus.OPTED_OUT

    def test_list_accepts_str_status(self, transport):
        transport.get.return_value = []
        resource = SmsOptInsResource(transport)

        resource.list(status="opted_in")

        transport.get.assert_called_once_with(
            "/sms-opt-ins",
            params={"status": "opted_in"},
        )

    def test_list_handles_items_wrapper(self, transport):
        transport.get.return_value = {"items": [OPT_IN_DICT]}
        resource = SmsOptInsResource(transport)

        rows = resource.list()

        assert len(rows) == 1
        assert rows[0].id == UUID(OPT_IN_DICT["id"])

    def test_get_by_receiver(self, transport):
        transport.get.return_value = OPT_IN_DICT
        resource = SmsOptInsResource(transport)

        row = resource.get("+15551234567")

        transport.get.assert_called_once_with("/sms-opt-ins/+15551234567")
        assert row.receiver_number == "+15551234567"
        assert row.status is SmsOptInStatus.OPTED_IN

    def test_opt_in_hits_correct_endpoint(self, transport):
        transport.post.return_value = OPT_IN_DICT
        resource = SmsOptInsResource(transport)

        row = resource.opt_in("+15551234567")

        transport.post.assert_called_once_with("/sms-opt-ins/+15551234567/opt-in")
        assert row.status is SmsOptInStatus.OPTED_IN
        assert row.source is SmsOptInSource.CUSTOMER_API
        assert row.opted_in_at is not None

    def test_opt_out_hits_correct_endpoint(self, transport):
        transport.post.return_value = OPT_OUT_DICT
        resource = SmsOptInsResource(transport)

        row = resource.opt_out("+15551234567")

        transport.post.assert_called_once_with("/sms-opt-ins/+15551234567/opt-out")
        assert row.status is SmsOptInStatus.OPTED_OUT
        assert row.opted_out_at is not None
        assert row.opted_in_at is None
