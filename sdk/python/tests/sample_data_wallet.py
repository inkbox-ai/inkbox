"""Sample API response dicts for wallet tests."""

from sample_data_identities import IDENTITY_WALLET_DICT

WALLET_BALANCE_DICT = {
    "wallet_id": IDENTITY_WALLET_DICT["id"],
    "chains": {
        "base": {
            "address": IDENTITY_WALLET_DICT["addresses"]["evm"],
            "native": {
                "symbol": "ETH",
                "balance": "0.5",
                "balance_raw": "500000000000000000",
                "decimals": 18,
            },
            "tokens": [
                {
                    "symbol": "USDC",
                    "contract_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                    "balance": "150.0",
                    "balance_raw": "150000000",
                    "decimals": 6,
                }
            ],
        },
        "tempo": {
            "address": IDENTITY_WALLET_DICT["addresses"]["evm"],
            "native": None,
            "tokens": [
                {
                    "symbol": "USDC.e",
                    "contract_address": "0x20C000000000000000000000b9537d11c60E8b50",
                    "balance": "50.0",
                    "balance_raw": "50000000",
                    "decimals": 6,
                }
            ],
        },
    },
}

WALLET_TRANSACTION_DICT = {
    "id": "99997777-0000-0000-0000-000000000001",
    "wallet_id": IDENTITY_WALLET_DICT["id"],
    "chain": "base",
    "chain_tx_hash": "0xdeadbeef",
    "from_address": IDENTITY_WALLET_DICT["addresses"]["evm"],
    "to_address": "0x1111111111111111111111111111111111111111",
    "token": "USDC",
    "amount_raw": "50000000",
    "amount_decimal": "50.0",
    "status": "pending",
    "failure_reason": None,
    "memo": "Payment for API call",
    "idempotency_key": "pay-123",
    "metadata": None,
    "created_at": "2026-03-09T00:00:00Z",
    "broadcast_at": "2026-03-09T00:00:01Z",
    "confirmed_at": None,
}

WALLET_AUTH_SIGNATURE_DICT = {
    "signer_address": IDENTITY_WALLET_DICT["addresses"]["evm"],
    "message": "example.com wants you to sign in",
    "digest": "0xabc123",
    "signature": "0xdef456",
    "r": "0xr",
    "s": "0xs",
    "v": 27,
}

WALLET_RECEIPT_DICT = {
    "tx_id": WALLET_TRANSACTION_DICT["id"],
    "chain_tx_hash": WALLET_TRANSACTION_DICT["chain_tx_hash"],
    "chain": WALLET_TRANSACTION_DICT["chain"],
    "status": "confirmed",
    "block_number": 123456,
    "gas_used": 21000,
    "explorer_url": "https://basescan.org/tx/0xdeadbeef",
}

ONCHAIN_TRANSACTION_DICT = {
    "chain": "base",
    "hash": "0xfeedface",
    "direction": "out",
    "from_address": IDENTITY_WALLET_DICT["addresses"]["evm"],
    "to_address": "0x2222222222222222222222222222222222222222",
    "token": "ETH",
    "amount_raw": "1000000000000000",
    "amount_decimal": "0.001",
    "decimals": 18,
    "status": "confirmed",
    "block_number": 123456,
    "confirmed_at": "2026-03-09T00:03:00Z",
    "explorer_url": "https://basescan.org/tx/0xfeedface",
}

ONCHAIN_TRANSACTION_PAGE_DICT = {
    "items": [ONCHAIN_TRANSACTION_DICT],
    "next_cursor": "cursor-123",
}

WALLET_PAY_REQUEST_RESPONSE_DICT = {
    "status": 200,
    "headers": {
        "content-type": "application/json",
    },
    "body": "eyJvayI6dHJ1ZX0=",
    "body_truncated": False,
    "payment": {
        "protocol": "mpp",
        "chain": "tempo",
        "currency": "USDC.e",
        "amount_raw": "1000000",
        "recipient": "0x3333333333333333333333333333333333333333",
        "tx_hash": "0xpaid",
    },
}
