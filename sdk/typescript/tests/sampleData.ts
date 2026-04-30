/** Shared raw (snake_case) API response fixtures for tests. */

// ---- Mail ----

export const RAW_MAILBOX = {
  id: "aaaa1111-0000-0000-0000-000000000001",
  email_address: "agent01@inkbox.ai",
  sending_domain: "inkbox.ai",
  display_name: "Agent 01",
  agent_identity_id: "eeee5555-0000-0000-0000-000000000001",
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
  sms_status: "ready",
  sms_error_code: null,
  sms_error_detail: null,
  sms_ready_at: "2026-03-09T00:01:00Z",
  incoming_call_action: "auto_reject",
  client_websocket_url: null,
  incoming_text_webhook_url: null,
  agent_identity_id: "eeee5555-0000-0000-0000-000000000001",
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

export const RAW_TEXT_MESSAGE_OUTBOUND_QUEUED = {
  id: "dddd4444-0000-0000-0000-0000000000ff",
  direction: "outbound",
  local_phone_number: "+18335794607",
  remote_phone_number: "+15167251294",
  text: "Hello from Inkbox",
  type: "sms",
  media: null,
  is_read: true,
  delivery_status: "queued",
  origin: "user_initiated",
  error_code: null,
  error_detail: null,
  sent_at: null,
  delivered_at: null,
  failed_at: null,
  created_at: "2026-03-09T00:20:00Z",
  updated_at: "2026-03-09T00:20:00Z",
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
  agent_identity_id: "eeee5555-0000-0000-0000-000000000001",
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
  agent_identity_id: "eeee5555-0000-0000-0000-000000000001",
  created_at: "2026-03-09T00:00:00Z",
  updated_at: "2026-03-09T00:00:00Z",
};

export const RAW_IDENTITY = {
  id: "eeee5555-0000-0000-0000-000000000001",
  organization_id: "org-abc123",
  agent_handle: "sales-agent",
  email_address: "sales-agent@inkboxmail.com",
  created_at: "2026-03-09T00:00:00Z",
  updated_at: "2026-03-09T00:00:00Z",
};

export const RAW_IDENTITY_DETAIL = {
  ...RAW_IDENTITY,
  mailbox: RAW_IDENTITY_MAILBOX,
  phone_number: RAW_IDENTITY_PHONE,
};

// ---- Domains ----

export const RAW_DOMAIN_VERIFIED = {
  id: "sending_domain_aaaa1111-0000-0000-0000-000000000001",
  domain: "mail.acme.com",
  status: "verified",
  is_default: true,
  verified_at: "2026-03-09T00:00:00Z",
};

export const RAW_DOMAIN_PENDING = {
  id: "sending_domain_bbbb2222-0000-0000-0000-000000000002",
  domain: "newsletter.acme.com",
  status: "pending",
  is_default: false,
  verified_at: null,
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
