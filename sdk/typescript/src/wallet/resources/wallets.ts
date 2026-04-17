/**
 * inkbox-wallet/resources/wallets.ts
 *
 * Wallet operations: create, list, balance, send, sign auth, history, and pay-request.
 */

import { HttpTransport } from "../../_http.js";
import {
  AgentWallet,
  AgentWalletBalance,
  OnchainTransactionPage,
  RawAgentWallet,
  RawAgentWalletBalance,
  RawOnchainTransactionPage,
  RawWalletAuthSignature,
  RawWalletPayRequestResponse,
  RawWalletTransaction,
  RawWalletTransactionReceipt,
  WalletAuthSignature,
  WalletPayRequestResponse,
  WalletTransaction,
  WalletTransactionReceipt,
  parseAgentWallet,
  parseAgentWalletBalance,
  parseOnchainTransactionPage,
  parseWalletAuthSignature,
  parseWalletPayRequestResponse,
  parseWalletTransaction,
  parseWalletTransactionReceipt,
} from "../types.js";

export class WalletsResource {
  constructor(private readonly http: HttpTransport) {}

  /** List wallets visible to the caller. */
  async list(): Promise<AgentWallet[]> {
    const data = await this.http.get<RawAgentWallet[]>("/");
    return data.map(parseAgentWallet);
  }

  /** Create a new wallet for an identity. */
  async create(options: {
    agentHandle: string;
    chains?: string[];
  }): Promise<AgentWallet> {
    const body: Record<string, unknown> = {
      agent_handle: options.agentHandle,
    };
    if (options.chains !== undefined) body["chains"] = options.chains;
    const data = await this.http.post<RawAgentWallet>("/", body);
    return parseAgentWallet(data);
  }

  /** Fetch a wallet by ID. */
  async get(walletId: string): Promise<AgentWallet> {
    const data = await this.http.get<RawAgentWallet>(`/${walletId}`);
    return parseAgentWallet(data);
  }

  /** Fetch live on-chain balances for a wallet. */
  async getBalance(walletId: string): Promise<AgentWalletBalance> {
    const data = await this.http.get<RawAgentWalletBalance>(`/${walletId}/balance`);
    return parseAgentWalletBalance(data);
  }

  /** Broadcast an outbound transaction from a wallet. */
  async send(
    walletId: string,
    options: {
      chain: string;
      toAddress: string;
      token: string;
      amount: string;
      memo?: string;
      idempotencyKey?: string;
    },
  ): Promise<WalletTransaction> {
    const body: Record<string, unknown> = {
      chain: options.chain,
      to_address: options.toAddress,
      token: options.token,
      amount: options.amount,
    };
    if (options.memo !== undefined) body["memo"] = options.memo;
    if (options.idempotencyKey !== undefined) body["idempotency_key"] = options.idempotencyKey;
    const data = await this.http.post<RawWalletTransaction>(`/${walletId}/send`, body);
    return parseWalletTransaction(data);
  }

  /** Sign a SIWE-style authentication challenge. */
  async signAuth(
    walletId: string,
    options: { message: string },
  ): Promise<WalletAuthSignature> {
    const data = await this.http.post<RawWalletAuthSignature>(
      `/${walletId}/sign-auth`,
      { message: options.message },
    );
    return parseWalletAuthSignature(data);
  }

  /** List wallet transactions from the server-side audit log. */
  async listTransactions(
    walletId: string,
    options: {
      chain?: string;
      status?: string;
      limit?: number;
    } = {},
  ): Promise<WalletTransaction[]> {
    const data = await this.http.get<RawWalletTransaction[]>(
      `/${walletId}/transactions`,
      {
        chain: options.chain,
        status: options.status,
        limit: options.limit,
      },
    );
    return data.map(parseWalletTransaction);
  }

  /** Fetch the current on-chain receipt state for one transaction row. */
  async getTransactionReceipt(
    walletId: string,
    transactionId: string,
  ): Promise<WalletTransactionReceipt> {
    const data = await this.http.get<RawWalletTransactionReceipt>(
      `/${walletId}/transactions/${transactionId}/receipt`,
    );
    return parseWalletTransactionReceipt(data);
  }

  /** List read-through on-chain history for a wallet. */
  async listOnchainTransactions(
    walletId: string,
    options: {
      chain?: string;
      direction?: string;
      cursor?: string;
      limit?: number;
    } = {},
  ): Promise<OnchainTransactionPage> {
    const data = await this.http.get<RawOnchainTransactionPage>(
      `/${walletId}/onchain-transactions`,
      {
        chain: options.chain,
        direction: options.direction,
        cursor: options.cursor,
        limit: options.limit,
      },
    );
    return parseOnchainTransactionPage(data);
  }

  /** Make an HTTP request and automatically pay any supported 402 challenge. */
  async payRequest(
    walletId: string,
    options: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      bodyBase64?: string;
      maxCost?: string | number;
    },
  ): Promise<WalletPayRequestResponse> {
    const body: Record<string, unknown> = {
      url: options.url,
    };
    if (options.method !== undefined) body["method"] = options.method;
    if (options.headers !== undefined) body["headers"] = options.headers;
    if (options.bodyBase64 !== undefined) body["body"] = options.bodyBase64;
    if (options.maxCost !== undefined) body["max_cost"] = String(options.maxCost);

    const data = await this.http.post<RawWalletPayRequestResponse>(
      `/${walletId}/pay-request`,
      body,
    );
    return parseWalletPayRequestResponse(data);
  }
}
