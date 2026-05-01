"""
sdk/python/tests/test_mail_domains.py

Tests for DomainsResource and the Domain dataclass.
"""

from datetime import datetime
from unittest.mock import MagicMock

from sample_data_mail import DOMAIN_PENDING_DICT, DOMAIN_VERIFIED_DICT

from inkbox.mail.resources.domains import DomainsResource
from inkbox.mail.types import Domain, SendingDomainStatus


def _resource():
    http = MagicMock()
    return DomainsResource(http), http


class TestDomainsList:
    def test_returns_parsed_domains(self):
        res, http = _resource()
        http.get.return_value = [DOMAIN_VERIFIED_DICT, DOMAIN_PENDING_DICT]

        domains = res.list()

        http.get.assert_called_once_with("/", params=None)
        assert len(domains) == 2
        assert domains[0].domain == "mail.acme.com"
        assert domains[0].status is SendingDomainStatus.VERIFIED
        assert domains[0].is_default is True
        assert isinstance(domains[0].verified_at, datetime)
        assert domains[1].verified_at is None

    def test_passes_status_filter(self):
        res, http = _resource()
        http.get.return_value = [DOMAIN_VERIFIED_DICT]

        res.list(status=SendingDomainStatus.VERIFIED)

        http.get.assert_called_once_with("/", params={"status": "verified"})


class TestDomainsSetDefault:
    def test_returns_bare_string(self):
        res, http = _resource()
        http.post.return_value = {"default_domain": "mail.acme.com"}

        result = res.set_default("mail.acme.com")

        http.post.assert_called_once_with("/mail.acme.com/set-default", json={})
        assert result == "mail.acme.com"

    def test_returns_none_when_reverted(self):
        res, http = _resource()
        http.post.return_value = {"default_domain": None}

        result = res.set_default("inkboxmail.com")

        assert result is None

    def test_url_encodes_domain_segment(self):
        res, http = _resource()
        http.post.return_value = {"default_domain": None}

        res.set_default("weird name@thing")

        http.post.assert_called_once_with(
            "/weird%20name%40thing/set-default", json={}
        )


class TestDomainParsing:
    def test_handles_null_verified_at(self):
        d = Domain._from_dict(DOMAIN_PENDING_DICT)

        assert d.verified_at is None
        assert d.status is SendingDomainStatus.PENDING
        assert d.is_default is False

    def test_parses_verified_at(self):
        d = Domain._from_dict(DOMAIN_VERIFIED_DICT)

        assert isinstance(d.verified_at, datetime)
        assert d.verified_at.year == 2026
