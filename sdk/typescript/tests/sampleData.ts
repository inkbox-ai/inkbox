/** Shared raw (snake_case) API response fixtures for tests. */

// ---- Mail ----

export const RAW_MAILBOX = {
  id: "aaaa1111-0000-0000-0000-000000000001",
  email_address: "agent01@inkbox.ai",
  display_name: "Agent 01",
  created_at: "2026-03-09T00:00:00Z",
  updated_at: "2026-03-09T00:00:00Z",
};

export const RAW_MESSAGE = {
  id: "bbbb2222-0000-0000-0000-000000000001",
  mailbox_id: "aaaa1111-0000-0000-0000-000000000001",
  thread_id: "eeee5555-0000-0000-0000-000000000001",
  message_id: "<abc123@mail.gmail.com>",
  from_address: "user@example.com",
  to_addresses: ["agent01@inkbox.ai"],
  cc_addresses: null,
  subject: "Hello from test",
  snippet: "Hi there, this is a test message...",
  direction: "inbound",
  status: "delivered",
  is_read: false,
  is_starred: false,
  has_attachments: false,
  created_at: "2026-03-09T00:00:00Z",
};

export const RAW_MESSAGE_DETAIL = {
  ...RAW_MESSAGE,
  body_text: "Hi there, this is a test message body.",
  body_html: "<p>Hi there, this is a test message body.</p>",
  bcc_addresses: null,
  in_reply_to: null,
  references: null,
  attachment_metadata: null,
  ses_message_id: "ses-abc123",
  updated_at: "2026-03-09T00:00:00Z",
};

export const RAW_THREAD = {
  id: "eeee5555-0000-0000-0000-000000000001",
  mailbox_id: "aaaa1111-0000-0000-0000-000000000001",
  subject: "Hello from test",
  message_count: 2,
  last_message_at: "2026-03-09T00:05:00Z",
  created_at: "2026-03-09T00:00:00Z",
};

export const RAW_THREAD_DETAIL = {
  ...RAW_THREAD,
  messages: [RAW_MESSAGE],
};

export const CURSOR_PAGE_MESSAGES = {
  items: [RAW_MESSAGE],
  next_cursor: null,
  has_more: false,
};

export const CURSOR_PAGE_MESSAGES_MULTI = {
  items: [RAW_MESSAGE],
  next_cursor: "cursor-abc",
  has_more: true,
};

export const CURSOR_PAGE_THREADS = {
  items: [RAW_THREAD],
  next_cursor: null,
  has_more: false,
};

// ---- Phone ----

export const RAW_PHONE_NUMBER = {
  id: "aaaa1111-0000-0000-0000-000000000001",
  number: "+18335794607",
  type: "toll_free",
  status: "active",
  incoming_call_action: "auto_reject",
  client_websocket_url: null,
  incoming_text_webhook_url: null,
  created_at: "2026-03-09T00:00:00Z",
  updated_at: "2026-03-09T00:00:00Z",
};

export const RAW_PHONE_CALL = {
  id: "bbbb2222-0000-0000-0000-000000000001",
  local_phone_number: "+18335794607",
  remote_phone_number: "+15167251294",
  direction: "outbound",
  status: "completed",
  client_websocket_url: "wss://agent.example.com/ws",
  use_inkbox_tts: null,
  use_inkbox_stt: null,
  hangup_reason: null,
  started_at: "2026-03-09T00:01:00Z",
  ended_at: "2026-03-09T00:05:00Z",
  created_at: "2026-03-09T00:00:00Z",
  updated_at: "2026-03-09T00:05:00Z",
};

export const RAW_RATE_LIMIT = {
  calls_used: 5,
  calls_remaining: 95,
  calls_limit: 100,
  minutes_used: 12.5,
  minutes_remaining: 987.5,
  minutes_limit: 1000,
};

export const RAW_PHONE_CALL_WITH_RATE_LIMIT = {
  ...RAW_PHONE_CALL,
  rate_limit: RAW_RATE_LIMIT,
};

export const RAW_PHONE_TRANSCRIPT = {
  id: "cccc3333-0000-0000-0000-000000000001",
  call_id: "bbbb2222-0000-0000-0000-000000000001",
  seq: 0,
  ts_ms: 1500,
  party: "local",
  text: "Hello, how can I help you?",
  created_at: "2026-03-09T00:01:01Z",
};

// ---- Texts ----

export const RAW_TEXT_MESSAGE = {
  id: "dddd4444-0000-0000-0000-000000000001",
  direction: "inbound",
  local_phone_number: "+18335794607",
  remote_phone_number: "+15167251294",
  text: "Hello, is this support?",
  type: "sms",
  media: null,
  is_read: false,
  created_at: "2026-03-09T00:10:00Z",
  updated_at: "2026-03-09T00:10:00Z",
};

export const RAW_TEXT_MESSAGE_MMS = {
  id: "dddd4444-0000-0000-0000-000000000002",
  direction: "inbound",
  local_phone_number: "+18335794607",
  remote_phone_number: "+15167251294",
  text: "Check this out",
  type: "mms",
  media: [
    {
      content_type: "image/jpeg",
      size: 534972,
      url: "https://s3.example.com/media/photo.jpg?signed=1",
    },
  ],
  is_read: true,
  created_at: "2026-03-09T00:12:00Z",
  updated_at: "2026-03-09T00:12:00Z",
};

export const RAW_TEXT_CONVERSATION_SUMMARY = {
  remote_phone_number: "+15167251294",
  latest_text: "Hello, is this support?",
  latest_direction: "inbound",
  latest_type: "sms",
  latest_message_at: "2026-03-09T00:10:00Z",
  unread_count: 3,
  total_count: 15,
};

// ---- Identities ----

export const RAW_IDENTITY_MAILBOX = {
  id: "aaaa1111-0000-0000-0000-000000000001",
  email_address: "sales-agent@inkbox.ai",
  display_name: "Sales Agent",
  created_at: "2026-03-09T00:00:00Z",
  updated_at: "2026-03-09T00:00:00Z",
};

export const RAW_IDENTITY_PHONE = {
  id: "bbbb2222-0000-0000-0000-000000000001",
  number: "+18335794607",
  type: "toll_free",
  status: "active",
  incoming_call_action: "auto_reject",
  client_websocket_url: null,
  incoming_text_webhook_url: null,
  created_at: "2026-03-09T00:00:00Z",
  updated_at: "2026-03-09T00:00:00Z",
};

export const RAW_WALLET = {
  id: "ffff6666-0000-0000-0000-000000000001",
  organization_id: "org-abc123",
  agent_identity_id: "eeee5555-0000-0000-0000-000000000001",
  status: "active",
  addresses: {
    evm: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  },
  chains: [
    { chain: "base" },
    { chain: "tempo" },
  ],
  created_at: "2026-03-09T00:00:00Z",
  updated_at: "2026-03-09T00:00:00Z",
};

export const RAW_IDENTITY = {
  id: "eeee5555-0000-0000-0000-000000000001",
  organization_id: "org-abc123",
  agent_handle: "sales-agent",
  email_address: "sales-agent@inkboxmail.com",
  wallet_id: RAW_WALLET.id,
  created_at: "2026-03-09T00:00:00Z",
  updated_at: "2026-03-09T00:00:00Z",
};

export const RAW_IDENTITY_DETAIL = {
  ...RAW_IDENTITY,
  mailbox: RAW_IDENTITY_MAILBOX,
  phone_number: RAW_IDENTITY_PHONE,
  wallet: RAW_WALLET,
};

// ---- Wallets ----

export const RAW_WALLET_BALANCE = {
  wallet_id: RAW_WALLET.id,
  chains: {
    base: {
      address: RAW_WALLET.addresses.evm,
      native: {
        symbol: "ETH",
        balance: "0.5",
        balance_raw: "500000000000000000",
        decimals: 18,
      },
      tokens: [
        {
          symbol: "USDC",
          contract_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          balance: "150.0",
          balance_raw: "150000000",
          decimals: 6,
        },
      ],
    },
    tempo: {
      address: RAW_WALLET.addresses.evm,
      native: null,
      tokens: [
        {
          symbol: "USDC.e",
          contract_address: "0x20C000000000000000000000b9537d11c60E8b50",
          balance: "50.0",
          balance_raw: "50000000",
          decimals: 6,
        },
      ],
    },
  },
};

export const RAW_WALLET_TRANSACTION = {
  id: "99997777-0000-0000-0000-000000000001",
  wallet_id: RAW_WALLET.id,
  chain: "base",
  chain_tx_hash: "0xdeadbeef",
  from_address: RAW_WALLET.addresses.evm,
  to_address: "0x1111111111111111111111111111111111111111",
  token: "USDC",
  amount_raw: "50000000",
  amount_decimal: "50.0",
  status: "pending",
  failure_reason: null,
  memo: "Payment for API call",
  idempotency_key: "pay-123",
  metadata: null,
  created_at: "2026-03-09T00:00:00Z",
  broadcast_at: "2026-03-09T00:00:01Z",
  confirmed_at: null,
};

export const RAW_WALLET_AUTH_SIGNATURE = {
  signer_address: RAW_WALLET.addresses.evm,
  message: "example.com wants you to sign in",
  digest: "0xabc123",
  signature: "0xdef456",
  r: "0xr",
  s: "0xs",
  v: 27,
};

export const RAW_WALLET_RECEIPT = {
  tx_id: RAW_WALLET_TRANSACTION.id,
  chain_tx_hash: RAW_WALLET_TRANSACTION.chain_tx_hash,
  chain: RAW_WALLET_TRANSACTION.chain,
  status: "confirmed",
  block_number: 123456,
  gas_used: 21000,
  explorer_url: "https://basescan.org/tx/0xdeadbeef",
};

export const RAW_ONCHAIN_TRANSACTION = {
  chain: "base",
  hash: "0xfeedface",
  direction: "out",
  from_address: RAW_WALLET.addresses.evm,
  to_address: "0x2222222222222222222222222222222222222222",
  token: "ETH",
  amount_raw: "1000000000000000",
  amount_decimal: "0.001",
  decimals: 18,
  status: "confirmed",
  block_number: 123456,
  confirmed_at: "2026-03-09T00:03:00Z",
  explorer_url: "https://basescan.org/tx/0xfeedface",
};

export const RAW_ONCHAIN_TRANSACTION_PAGE = {
  items: [RAW_ONCHAIN_TRANSACTION],
  next_cursor: "cursor-123",
};

export const RAW_WALLET_PAY_REQUEST_RESPONSE = {
  status: 200,
  headers: {
    "content-type": "application/json",
  },
  body: "eyJvayI6dHJ1ZX0=",
  body_truncated: false,
  payment: {
    protocol: "mpp",
    chain: "tempo",
    currency: "USDC.e",
    amount_raw: "1000000",
    recipient: "0x3333333333333333333333333333333333333333",
    tx_hash: "0xpaid",
  },
};

// ---- Signing Keys ----

export const RAW_SIGNING_KEY = {
  signing_key: "sk-test-hmac-secret-abc123",
  created_at: "2026-03-09T00:00:00Z",
};

// ---- Whoami ----

export const RAW_WHOAMI_API_KEY = {
  auth_type: "api_key" as const,
  auth_subtype: "human",
  organization_id: "org-abc123",
  created_by: "user_abc",
  creator_type: "human",
  key_id: "key_xyz",
  label: "My Key",
  description: "Dev key",
  created_at: 1711929600,
  last_used_at: 1711933200,
  expires_at: null,
};

export const RAW_WHOAMI_JWT = {
  auth_type: "jwt" as const,
  auth_subtype: "clerk",
  user_id: "user_abc",
  email: "dev@example.com",
  name: "Dev User",
  organization_id: "org-abc123",
  org_role: "admin",
  org_slug: "my-org",
};
