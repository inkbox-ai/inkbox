"""
inkbox/wallet/types.py

Dataclasses mirroring the Inkbox Wallet API response models.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


@dataclass
class AgentWalletChain:
    """One chain activation on a wallet."""

    chain: str

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> AgentWalletChain:
        return cls(chain=d["chain"])


@dataclass
class AgentWallet:
    """A custodial agent wallet."""

    id: UUID
    organization_id: str
    agent_identity_id: UUID | None
    status: str
    addresses: dict[str, str]
    chains: list[AgentWalletChain]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> AgentWallet:
        return cls(
            id=UUID(d["id"]),
            organization_id=d["organization_id"],
            agent_identity_id=UUID(d["agent_identity_id"]) if d.get("agent_identity_id") else None,
            status=d["status"],
            addresses=d["addresses"],
            chains=[AgentWalletChain._from_dict(c) for c in d.get("chains", [])],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


@dataclass
class NativeBalance:
    symbol: str
    balance: str
    balance_raw: str
    decimals: int

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> NativeBalance:
        return cls(
            symbol=d["symbol"],
            balance=d["balance"],
            balance_raw=d["balance_raw"],
            decimals=d["decimals"],
        )


@dataclass
class TokenBalance:
    symbol: str
    contract_address: str
    balance: str
    balance_raw: str
    decimals: int

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> TokenBalance:
        return cls(
            symbol=d["symbol"],
            contract_address=d["contract_address"],
            balance=d["balance"],
            balance_raw=d["balance_raw"],
            decimals=d["decimals"],
        )


@dataclass
class WalletChainBalance:
    address: str
    native: NativeBalance | None
    tokens: list[TokenBalance]

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WalletChainBalance:
        return cls(
            address=d["address"],
            native=NativeBalance._from_dict(d["native"]) if d.get("native") else None,
            tokens=[TokenBalance._from_dict(t) for t in d.get("tokens", [])],
        )


@dataclass
class AgentWalletBalance:
    wallet_id: UUID
    chains: dict[str, WalletChainBalance]

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> AgentWalletBalance:
        return cls(
            wallet_id=UUID(d["wallet_id"]),
            chains={
                chain: WalletChainBalance._from_dict(balance)
                for chain, balance in d.get("chains", {}).items()
            },
        )


@dataclass
class WalletTransaction:
    id: UUID
    wallet_id: UUID
    chain: str
    chain_tx_hash: str | None
    from_address: str
    to_address: str
    token: str
    amount_raw: str
    amount_decimal: str
    status: str
    failure_reason: str | None
    memo: str | None
    idempotency_key: str | None
    metadata: dict[str, Any] | None
    created_at: datetime
    broadcast_at: datetime | None
    confirmed_at: datetime | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WalletTransaction:
        return cls(
            id=UUID(d["id"]),
            wallet_id=UUID(d["wallet_id"]),
            chain=d["chain"],
            chain_tx_hash=d.get("chain_tx_hash"),
            from_address=d["from_address"],
            to_address=d["to_address"],
            token=d["token"],
            amount_raw=d["amount_raw"],
            amount_decimal=d["amount_decimal"],
            status=d["status"],
            failure_reason=d.get("failure_reason"),
            memo=d.get("memo"),
            idempotency_key=d.get("idempotency_key"),
            metadata=d.get("metadata"),
            created_at=datetime.fromisoformat(d["created_at"]),
            broadcast_at=_dt(d.get("broadcast_at")),
            confirmed_at=_dt(d.get("confirmed_at")),
        )


@dataclass
class WalletAuthSignature:
    signer_address: str
    message: str
    digest: str
    signature: str
    r: str
    s: str
    v: int

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WalletAuthSignature:
        return cls(
            signer_address=d["signer_address"],
            message=d["message"],
            digest=d["digest"],
            signature=d["signature"],
            r=d["r"],
            s=d["s"],
            v=d["v"],
        )


@dataclass
class WalletTransactionReceipt:
    tx_id: UUID
    chain_tx_hash: str | None
    chain: str
    status: str
    block_number: int | None
    gas_used: int | None
    explorer_url: str | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WalletTransactionReceipt:
        return cls(
            tx_id=UUID(d["tx_id"]),
            chain_tx_hash=d.get("chain_tx_hash"),
            chain=d["chain"],
            status=d["status"],
            block_number=d.get("block_number"),
            gas_used=d.get("gas_used"),
            explorer_url=d.get("explorer_url"),
        )


@dataclass
class WalletPayRequestResponse:
    status: int
    headers: dict[str, str]
    body_base64: str
    body_truncated: bool
    payment: dict[str, Any] | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WalletPayRequestResponse:
        return cls(
            status=d["status"],
            headers=d["headers"],
            body_base64=d["body"],
            body_truncated=d.get("body_truncated", False),
            payment=d.get("payment"),
        )
