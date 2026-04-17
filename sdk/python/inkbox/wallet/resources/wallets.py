"""
inkbox/wallet/resources/wallets.py

Wallet operations: create, list, balance, send, sign auth, history, and pay-request.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.wallet.types import (
    AgentWallet,
    AgentWalletBalance,
    WalletAuthSignature,
    WalletPayRequestResponse,
    WalletTransaction,
    WalletTransactionReceipt,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class WalletsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(self) -> list[AgentWallet]:
        """List wallets visible to the caller."""
        data = self._http.get("/")
        return [AgentWallet._from_dict(item) for item in data]

    def create(
        self,
        *,
        agent_handle: str,
        chains: list[str] | None = None,
    ) -> AgentWallet:
        """Create a new wallet for an identity."""
        body: dict[str, Any] = {"agent_handle": agent_handle}
        if chains is not None:
            body["chains"] = chains
        data = self._http.post("/", json=body)
        return AgentWallet._from_dict(data)

    def get(self, wallet_id: UUID | str) -> AgentWallet:
        """Fetch a wallet by ID."""
        data = self._http.get(f"/{wallet_id}")
        return AgentWallet._from_dict(data)

    def get_balance(self, wallet_id: UUID | str) -> AgentWalletBalance:
        """Fetch live on-chain balances for a wallet."""
        data = self._http.get(f"/{wallet_id}/balance")
        return AgentWalletBalance._from_dict(data)

    def send(
        self,
        wallet_id: UUID | str,
        *,
        chain: str,
        to_address: str,
        token: str,
        amount: str,
        memo: str | None = None,
        idempotency_key: str | None = None,
    ) -> WalletTransaction:
        """Broadcast an outbound transaction from a wallet."""
        body: dict[str, Any] = {
            "chain": chain,
            "to_address": to_address,
            "token": token,
            "amount": amount,
        }
        if memo is not None:
            body["memo"] = memo
        if idempotency_key is not None:
            body["idempotency_key"] = idempotency_key
        data = self._http.post(f"/{wallet_id}/send", json=body)
        return WalletTransaction._from_dict(data)

    def sign_auth(
        self,
        wallet_id: UUID | str,
        *,
        message: str,
    ) -> WalletAuthSignature:
        """Sign a SIWE-style authentication challenge."""
        data = self._http.post(
            f"/{wallet_id}/sign-auth",
            json={"message": message},
        )
        return WalletAuthSignature._from_dict(data)

    def list_transactions(
        self,
        wallet_id: UUID | str,
        *,
        chain: str | None = None,
        status: str | None = None,
        limit: int | None = None,
    ) -> list[WalletTransaction]:
        """List wallet transactions from the server-side audit log."""
        data = self._http.get(
            f"/{wallet_id}/transactions",
            params={"chain": chain, "status": status, "limit": limit},
        )
        return [WalletTransaction._from_dict(item) for item in data]

    def get_transaction_receipt(
        self,
        wallet_id: UUID | str,
        transaction_id: UUID | str,
    ) -> WalletTransactionReceipt:
        """Fetch the current on-chain receipt state for one transaction row."""
        data = self._http.get(f"/{wallet_id}/transactions/{transaction_id}/receipt")
        return WalletTransactionReceipt._from_dict(data)

    def pay_request(
        self,
        wallet_id: UUID | str,
        *,
        url: str,
        method: str | None = None,
        headers: dict[str, str] | None = None,
        body_base64: str | None = None,
        max_cost: str | int | float | None = None,
    ) -> WalletPayRequestResponse:
        """Make an HTTP request and automatically pay any supported 402 challenge."""
        body: dict[str, Any] = {"url": url}
        if method is not None:
            body["method"] = method
        if headers is not None:
            body["headers"] = headers
        if body_base64 is not None:
            body["body"] = body_base64
        if max_cost is not None:
            body["max_cost"] = str(max_cost)
        data = self._http.post(f"/{wallet_id}/pay-request", json=body)
        return WalletPayRequestResponse._from_dict(data)
