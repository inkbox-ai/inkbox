import { describe, it, expect, vi } from "vitest";
import type { HttpTransport } from "../../src/_http.js";
import { WalletsResource } from "../../src/wallet/resources/wallets.js";
import {
  RAW_WALLET,
  RAW_WALLET_AUTH_SIGNATURE,
  RAW_WALLET_BALANCE,
  RAW_WALLET_PAY_REQUEST_RESPONSE,
  RAW_WALLET_RECEIPT,
  RAW_WALLET_TRANSACTION,
} from "../sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const WALLET_ID = RAW_WALLET.id;

describe("WalletsResource", () => {
  it("lists wallets", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_WALLET]);
    const res = new WalletsResource(http);

    const wallets = await res.list();

    expect(http.get).toHaveBeenCalledWith("/");
    expect(wallets[0].addresses.evm).toBe(RAW_WALLET.addresses.evm);
  });

  it("creates a wallet", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_WALLET);
    const res = new WalletsResource(http);

    const wallet = await res.create({ agentHandle: "sales-agent", chains: ["base"] });

    expect(http.post).toHaveBeenCalledWith("/", {
      agent_handle: "sales-agent",
      chains: ["base"],
    });
    expect(wallet.id).toBe(WALLET_ID);
  });

  it("gets wallet balance", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_WALLET_BALANCE);
    const res = new WalletsResource(http);

    const balance = await res.getBalance(WALLET_ID);

    expect(http.get).toHaveBeenCalledWith(`/${WALLET_ID}/balance`);
    expect(balance.chains.base.native?.balance).toBe("0.5");
  });

  it("sends a transaction", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_WALLET_TRANSACTION);
    const res = new WalletsResource(http);

    const tx = await res.send(WALLET_ID, {
      chain: "base",
      toAddress: "0x1111111111111111111111111111111111111111",
      token: "USDC",
      amount: "50.0",
      memo: "Payment",
      idempotencyKey: "pay-123",
    });

    expect(http.post).toHaveBeenCalledWith(`/${WALLET_ID}/send`, {
      chain: "base",
      to_address: "0x1111111111111111111111111111111111111111",
      token: "USDC",
      amount: "50.0",
      memo: "Payment",
      idempotency_key: "pay-123",
    });
    expect(tx.id).toBe(RAW_WALLET_TRANSACTION.id);
  });

  it("signs auth messages", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_WALLET_AUTH_SIGNATURE);
    const res = new WalletsResource(http);

    const signature = await res.signAuth(WALLET_ID, { message: "hello" });

    expect(http.post).toHaveBeenCalledWith(`/${WALLET_ID}/sign-auth`, { message: "hello" });
    expect(signature.signature).toBe("0xdef456");
  });

  it("lists transactions", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_WALLET_TRANSACTION]);
    const res = new WalletsResource(http);

    const items = await res.listTransactions(WALLET_ID, { chain: "base", status: "pending", limit: 10 });

    expect(http.get).toHaveBeenCalledWith(`/${WALLET_ID}/transactions`, {
      chain: "base",
      status: "pending",
      limit: 10,
    });
    expect(items).toHaveLength(1);
  });

  it("gets a transaction receipt", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_WALLET_RECEIPT);
    const res = new WalletsResource(http);

    const receipt = await res.getTransactionReceipt(WALLET_ID, RAW_WALLET_TRANSACTION.id);

    expect(http.get).toHaveBeenCalledWith(
      `/${WALLET_ID}/transactions/${RAW_WALLET_TRANSACTION.id}/receipt`,
    );
    expect(receipt.status).toBe("confirmed");
  });

  it("pays requests", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_WALLET_PAY_REQUEST_RESPONSE);
    const res = new WalletsResource(http);

    const result = await res.payRequest(WALLET_ID, {
      url: "https://example.com",
      method: "POST",
      headers: { "content-type": "application/json" },
      bodyBase64: "eyJvayI6dHJ1ZX0=",
      maxCost: "0.25",
    });

    expect(http.post).toHaveBeenCalledWith(`/${WALLET_ID}/pay-request`, {
      url: "https://example.com",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "eyJvayI6dHJ1ZX0=",
      max_cost: "0.25",
    });
    expect(result.payment?.protocol).toBe("mpp");
  });
});
