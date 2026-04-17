"""
sdk/python/tests/test_wallets.py

Tests for WalletsResource.
"""

from sample_data_identities import IDENTITY_WALLET_DICT
from sample_data_wallet import (
    ONCHAIN_TRANSACTION_PAGE_DICT,
    WALLET_AUTH_SIGNATURE_DICT,
    WALLET_BALANCE_DICT,
    WALLET_PAY_REQUEST_RESPONSE_DICT,
    WALLET_RECEIPT_DICT,
    WALLET_TRANSACTION_DICT,
)


class TestWalletsList:
    def test_returns_wallets(self, client, transport):
        transport.get.return_value = [IDENTITY_WALLET_DICT]

        wallets = client.wallets.list()

        transport.get.assert_called_once_with("/")
        assert wallets[0].addresses["evm"] == IDENTITY_WALLET_DICT["addresses"]["evm"]


class TestWalletsCreate:
    def test_creates_wallet(self, client, transport):
        transport.post.return_value = IDENTITY_WALLET_DICT

        wallet = client.wallets.create(agent_handle="sales-agent", chains=["base"])

        transport.post.assert_called_once_with(
            "/",
            json={"agent_handle": "sales-agent", "chains": ["base"]},
        )
        assert str(wallet.id) == IDENTITY_WALLET_DICT["id"]


class TestWalletsBalance:
    def test_gets_balance(self, client, transport):
        transport.get.return_value = WALLET_BALANCE_DICT

        balance = client.wallets.get_balance(IDENTITY_WALLET_DICT["id"])

        transport.get.assert_called_once_with(f"/{IDENTITY_WALLET_DICT['id']}/balance")
        assert balance.chains["base"].native.symbol == "ETH"


class TestWalletsSend:
    def test_sends_transaction(self, client, transport):
        transport.post.return_value = WALLET_TRANSACTION_DICT

        tx = client.wallets.send(
            IDENTITY_WALLET_DICT["id"],
            chain="base",
            to_address="0x1111111111111111111111111111111111111111",
            token="USDC",
            amount="50.0",
            memo="Payment",
            idempotency_key="pay-123",
        )

        transport.post.assert_called_once_with(
            f"/{IDENTITY_WALLET_DICT['id']}/send",
            json={
                "chain": "base",
                "to_address": "0x1111111111111111111111111111111111111111",
                "token": "USDC",
                "amount": "50.0",
                "memo": "Payment",
                "idempotency_key": "pay-123",
            },
        )
        assert str(tx.id) == WALLET_TRANSACTION_DICT["id"]


class TestWalletsSignAuth:
    def test_signs_auth(self, client, transport):
        transport.post.return_value = WALLET_AUTH_SIGNATURE_DICT

        signature = client.wallets.sign_auth(
            IDENTITY_WALLET_DICT["id"],
            message="hello",
        )

        transport.post.assert_called_once_with(
            f"/{IDENTITY_WALLET_DICT['id']}/sign-auth",
            json={"message": "hello"},
        )
        assert signature.signature == "0xdef456"


class TestWalletsTransactions:
    def test_lists_transactions(self, client, transport):
        transport.get.return_value = [WALLET_TRANSACTION_DICT]

        items = client.wallets.list_transactions(
            IDENTITY_WALLET_DICT["id"],
            chain="base",
            status="pending",
            limit=10,
        )

        transport.get.assert_called_once_with(
            f"/{IDENTITY_WALLET_DICT['id']}/transactions",
            params={"chain": "base", "status": "pending", "limit": 10},
        )
        assert len(items) == 1

    def test_gets_receipt(self, client, transport):
        transport.get.return_value = WALLET_RECEIPT_DICT

        receipt = client.wallets.get_transaction_receipt(
            IDENTITY_WALLET_DICT["id"],
            WALLET_TRANSACTION_DICT["id"],
        )

        transport.get.assert_called_once_with(
            f"/{IDENTITY_WALLET_DICT['id']}/transactions/{WALLET_TRANSACTION_DICT['id']}/receipt"
        )
        assert receipt.status == "confirmed"


class TestWalletsOnchainHistory:
    def test_lists_onchain_transactions(self, client, transport):
        transport.get.return_value = ONCHAIN_TRANSACTION_PAGE_DICT

        page = client.wallets.list_onchain_transactions(
            IDENTITY_WALLET_DICT["id"],
            chain="base",
            limit=25,
        )

        transport.get.assert_called_once_with(
            f"/{IDENTITY_WALLET_DICT['id']}/onchain-transactions",
            params={"chain": "base", "direction": None, "cursor": None, "limit": 25},
        )
        assert len(page.items) == 1


class TestWalletsPayRequest:
    def test_pays_request(self, client, transport):
        transport.post.return_value = WALLET_PAY_REQUEST_RESPONSE_DICT

        result = client.wallets.pay_request(
            IDENTITY_WALLET_DICT["id"],
            url="https://example.com",
            method="POST",
            headers={"content-type": "application/json"},
            body_base64="eyJvayI6dHJ1ZX0=",
            max_cost="0.25",
        )

        transport.post.assert_called_once_with(
            f"/{IDENTITY_WALLET_DICT['id']}/pay-request",
            json={
                "url": "https://example.com",
                "method": "POST",
                "headers": {"content-type": "application/json"},
                "body": "eyJvayI6dHJ1ZX0=",
                "max_cost": "0.25",
            },
        )
        assert result.payment["protocol"] == "mpp"
