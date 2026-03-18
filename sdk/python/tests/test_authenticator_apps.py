"""Tests for AuthenticatorAppsResource."""

from unittest.mock import MagicMock

from sample_data_authenticator import AUTHENTICATOR_APP_DICT, AUTHENTICATOR_APP_UNLINKED_DICT
from inkbox.authenticator.resources.apps import AuthenticatorAppsResource
from inkbox.authenticator.types import AuthenticatorApp


def _resource():
    http = MagicMock()
    return AuthenticatorAppsResource(http), http


class TestAuthenticatorAppsCreate:
    def test_creates_app_with_handle(self):
        res, http = _resource()
        http.post.return_value = AUTHENTICATOR_APP_DICT

        app = res.create(agent_handle="sales-agent")

        http.post.assert_called_once_with("/apps", json={"agent_handle": "sales-agent"})
        assert isinstance(app, AuthenticatorApp)
        assert str(app.id) == AUTHENTICATOR_APP_DICT["id"]

    def test_creates_unbound_app(self):
        res, http = _resource()
        http.post.return_value = AUTHENTICATOR_APP_UNLINKED_DICT

        app = res.create()

        http.post.assert_called_once_with("/apps", json={})
        assert app.identity_id is None

    def test_identity_id_parsed(self):
        res, http = _resource()
        http.post.return_value = AUTHENTICATOR_APP_DICT

        app = res.create(agent_handle="sales-agent")

        assert str(app.identity_id) == AUTHENTICATOR_APP_DICT["identity_id"]


class TestAuthenticatorAppsList:
    def test_returns_list(self):
        res, http = _resource()
        http.get.return_value = [AUTHENTICATOR_APP_DICT]

        apps = res.list()

        http.get.assert_called_once_with("/apps")
        assert len(apps) == 1
        assert isinstance(apps[0], AuthenticatorApp)

    def test_empty_list(self):
        res, http = _resource()
        http.get.return_value = []

        assert res.list() == []


class TestAuthenticatorAppsGet:
    def test_returns_app(self):
        res, http = _resource()
        app_id = AUTHENTICATOR_APP_DICT["id"]
        http.get.return_value = AUTHENTICATOR_APP_DICT

        app = res.get(app_id)

        http.get.assert_called_once_with(f"/apps/{app_id}")
        assert isinstance(app, AuthenticatorApp)
        assert str(app.id) == app_id


class TestAuthenticatorAppsDelete:
    def test_deletes_app(self):
        res, http = _resource()
        app_id = AUTHENTICATOR_APP_DICT["id"]

        res.delete(app_id)

        http.delete.assert_called_once_with(f"/apps/{app_id}")
