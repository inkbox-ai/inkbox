import { describe, it, expect } from "vitest";
import {
  parseAgentWallet,
  parseAgentWalletBalance,
  parseOnchainTransactionPage,
  parseWalletAuthSignature,
  parseWalletPayRequestResponse,
  parseWalletTransaction,
  parseWalletTransactionReceipt,
} from "../../src/wallet/types.js";
import {
  RAW_ONCHAIN_TRANSACTION_PAGE,
  RAW_WALLET,
  RAW_WALLET_AUTH_SIGNATURE,
  RAW_WALLET_BALANCE,
  RAW_WALLET_PAY_REQUEST_RESPONSE,
  RAW_WALLET_RECEIPT,
  RAW_WALLET_TRANSACTION,
} from "../sampleData.js";

describe("parseAgentWallet", () => {
  it("converts wallet fields", () => {
    const wallet = parseAgentWallet(RAW_WALLET);
    expect(wallet.id).toBe(RAW_WALLET.id);
    expect(wallet.organizationId).toBe("org-abc123");
    expect(wallet.addresses.evm).toBe(RAW_WALLET.addresses.evm);
    expect(wallet.chains).toHaveLength(2);
    expect(wallet.createdAt).toBeInstanceOf(Date);
  });
});

describe("wallet parsers", () => {
  it("parses balances", () => {
    const balance = parseAgentWalletBalance(RAW_WALLET_BALANCE);
    expect(balance.walletId).toBe(RAW_WALLET.id);
    expect(balance.chains.base.native?.symbol).toBe("ETH");
    expect(balance.chains.tempo.tokens[0].symbol).toBe("USDC.e");
  });

  it("parses transaction rows", () => {
    const tx = parseWalletTransaction(RAW_WALLET_TRANSACTION);
    expect(tx.id).toBe(RAW_WALLET_TRANSACTION.id);
    expect(tx.chainTxHash).toBe("0xdeadbeef");
    expect(tx.broadcastAt).toBeInstanceOf(Date);
  });

  it("parses auth signatures", () => {
    const signature = parseWalletAuthSignature(RAW_WALLET_AUTH_SIGNATURE);
    expect(signature.signerAddress).toBe(RAW_WALLET.addresses.evm);
    expect(signature.v).toBe(27);
  });

  it("parses receipts", () => {
    const receipt = parseWalletTransactionReceipt(RAW_WALLET_RECEIPT);
    expect(receipt.txId).toBe(RAW_WALLET_TRANSACTION.id);
    expect(receipt.explorerUrl).toContain("basescan.org");
  });

  it("parses onchain pages", () => {
    const page = parseOnchainTransactionPage(RAW_ONCHAIN_TRANSACTION_PAGE);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].confirmedAt).toBeInstanceOf(Date);
    expect(page.nextCursor).toBe("cursor-123");
  });

  it("parses pay-request responses", () => {
    const result = parseWalletPayRequestResponse(RAW_WALLET_PAY_REQUEST_RESPONSE);
    expect(result.status).toBe(200);
    expect(result.bodyBase64).toBe("eyJvayI6dHJ1ZX0=");
    expect(result.payment?.protocol).toBe("mpp");
  });
});
