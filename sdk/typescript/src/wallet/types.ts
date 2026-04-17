/**
 * inkbox-wallet TypeScript SDK — public types.
 */

export interface AgentWalletChain {
  chain: string;
}

export interface AgentWallet {
  id: string;
  organizationId: string;
  agentIdentityId: string | null;
  status: string;
  addresses: Record<string, string>;
  chains: AgentWalletChain[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NativeBalance {
  symbol: string;
  balance: string;
  balanceRaw: string;
  decimals: number;
}

export interface TokenBalance {
  symbol: string;
  contractAddress: string;
  balance: string;
  balanceRaw: string;
  decimals: number;
}

export interface WalletChainBalance {
  address: string;
  native: NativeBalance | null;
  tokens: TokenBalance[];
}

export interface AgentWalletBalance {
  walletId: string;
  chains: Record<string, WalletChainBalance>;
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  chain: string;
  chainTxHash: string | null;
  fromAddress: string;
  toAddress: string;
  token: string;
  amountRaw: string;
  amountDecimal: string;
  status: string;
  failureReason: string | null;
  memo: string | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  broadcastAt: Date | null;
  confirmedAt: Date | null;
}

export interface WalletAuthSignature {
  signerAddress: string;
  message: string;
  digest: string;
  signature: string;
  r: string;
  s: string;
  v: number;
}

export interface WalletTransactionReceipt {
  txId: string;
  chainTxHash: string | null;
  chain: string;
  status: string;
  blockNumber: number | null;
  gasUsed: number | null;
  explorerUrl: string | null;
}

export interface WalletPayRequestResponse {
  status: number;
  headers: Record<string, string>;
  bodyBase64: string;
  bodyTruncated: boolean;
  payment: Record<string, unknown> | null;
}

// ---- internal raw API shapes (snake_case from JSON) ----

export interface RawAgentWalletChain {
  chain: string;
}

export interface RawAgentWallet {
  id: string;
  organization_id: string;
  agent_identity_id: string | null;
  status: string;
  addresses: Record<string, string>;
  chains: RawAgentWalletChain[];
  created_at: string;
  updated_at: string;
}

export interface RawNativeBalance {
  symbol: string;
  balance: string;
  balance_raw: string;
  decimals: number;
}

export interface RawTokenBalance {
  symbol: string;
  contract_address: string;
  balance: string;
  balance_raw: string;
  decimals: number;
}

export interface RawWalletChainBalance {
  address: string;
  native: RawNativeBalance | null;
  tokens: RawTokenBalance[];
}

export interface RawAgentWalletBalance {
  wallet_id: string;
  chains: Record<string, RawWalletChainBalance>;
}

export interface RawWalletTransaction {
  id: string;
  wallet_id: string;
  chain: string;
  chain_tx_hash: string | null;
  from_address: string;
  to_address: string;
  token: string;
  amount_raw: string;
  amount_decimal: string;
  status: string;
  failure_reason: string | null;
  memo: string | null;
  idempotency_key: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  broadcast_at: string | null;
  confirmed_at: string | null;
}

export interface RawWalletAuthSignature {
  signer_address: string;
  message: string;
  digest: string;
  signature: string;
  r: string;
  s: string;
  v: number;
}

export interface RawWalletTransactionReceipt {
  tx_id: string;
  chain_tx_hash: string | null;
  chain: string;
  status: string;
  block_number: number | null;
  gas_used: number | null;
  explorer_url: string | null;
}

export interface RawWalletPayRequestResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  body_truncated: boolean;
  payment: Record<string, unknown> | null;
}

// ---- parsers ----

export function parseAgentWalletChain(r: RawAgentWalletChain): AgentWalletChain {
  return { chain: r.chain };
}

export function parseAgentWallet(r: RawAgentWallet): AgentWallet {
  return {
    id: r.id,
    organizationId: r.organization_id,
    agentIdentityId: r.agent_identity_id,
    status: r.status,
    addresses: r.addresses,
    chains: r.chains.map(parseAgentWalletChain),
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseNativeBalance(r: RawNativeBalance): NativeBalance {
  return {
    symbol: r.symbol,
    balance: r.balance,
    balanceRaw: r.balance_raw,
    decimals: r.decimals,
  };
}

export function parseTokenBalance(r: RawTokenBalance): TokenBalance {
  return {
    symbol: r.symbol,
    contractAddress: r.contract_address,
    balance: r.balance,
    balanceRaw: r.balance_raw,
    decimals: r.decimals,
  };
}

export function parseWalletChainBalance(r: RawWalletChainBalance): WalletChainBalance {
  return {
    address: r.address,
    native: r.native ? parseNativeBalance(r.native) : null,
    tokens: r.tokens.map(parseTokenBalance),
  };
}

export function parseAgentWalletBalance(r: RawAgentWalletBalance): AgentWalletBalance {
  return {
    walletId: r.wallet_id,
    chains: Object.fromEntries(
      Object.entries(r.chains).map(([chain, balance]) => [chain, parseWalletChainBalance(balance)]),
    ),
  };
}

export function parseWalletTransaction(r: RawWalletTransaction): WalletTransaction {
  return {
    id: r.id,
    walletId: r.wallet_id,
    chain: r.chain,
    chainTxHash: r.chain_tx_hash,
    fromAddress: r.from_address,
    toAddress: r.to_address,
    token: r.token,
    amountRaw: r.amount_raw,
    amountDecimal: r.amount_decimal,
    status: r.status,
    failureReason: r.failure_reason,
    memo: r.memo,
    idempotencyKey: r.idempotency_key,
    metadata: r.metadata ?? null,
    createdAt: new Date(r.created_at),
    broadcastAt: r.broadcast_at ? new Date(r.broadcast_at) : null,
    confirmedAt: r.confirmed_at ? new Date(r.confirmed_at) : null,
  };
}

export function parseWalletAuthSignature(r: RawWalletAuthSignature): WalletAuthSignature {
  return {
    signerAddress: r.signer_address,
    message: r.message,
    digest: r.digest,
    signature: r.signature,
    r: r.r,
    s: r.s,
    v: r.v,
  };
}

export function parseWalletTransactionReceipt(
  r: RawWalletTransactionReceipt,
): WalletTransactionReceipt {
  return {
    txId: r.tx_id,
    chainTxHash: r.chain_tx_hash,
    chain: r.chain,
    status: r.status,
    blockNumber: r.block_number,
    gasUsed: r.gas_used,
    explorerUrl: r.explorer_url,
  };
}

export function parseWalletPayRequestResponse(
  r: RawWalletPayRequestResponse,
): WalletPayRequestResponse {
  return {
    status: r.status,
    headers: r.headers,
    bodyBase64: r.body,
    bodyTruncated: r.body_truncated,
    payment: r.payment ?? null,
  };
}
