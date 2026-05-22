export { Inkbox } from "./inkbox.js";
export { AgentIdentity } from "./agent_identity.js";
export { Credentials } from "./credentials.js";
export type { InkboxOptions, SignupOptions } from "./inkbox.js";
export type {
  AgentSignupRequest,
  AgentSignupResponse,
  AgentSignupVerifyRequest,
  AgentSignupVerifyResponse,
  AgentSignupResendResponse,
  SignupRestrictions,
  AgentSignupStatusResponse,
} from "./agent_signup/types.js";
export {
  DuplicateContactRuleError,
  InkboxAPIError,
  InkboxError,
  InkboxVaultKeyError,
  RecipientBlockedError,
  RedundantContactAccessGrantError,
} from "./_http.js";
export type { InkboxAPIErrorDetail } from "./_http.js";
export type {
  WhoamiApiKeyResponse,
  WhoamiJwtResponse,
  WhoamiResponse,
} from "./whoami/types.js";
export {
  AUTH_SUBTYPE_API_KEY_ADMIN_SCOPED,
  AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_CLAIMED,
  AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_UNCLAIMED,
} from "./whoami/types.js";
export type { SigningKey } from "./signing_keys.js";
export { verifyWebhook } from "./signing_keys.js";
export type {
  WebhookContact,
  WebhookMailContact,
  MailContactBucket,
  MailWebhookPayload,
  MailWebhookEventType,
  MailWebhookMessage,
  MessageStatus,
  MessageDirectionWire,
  TextWebhookPayload,
  TextWebhookEventType,
  TextWebhookMessage,
  TextDirectionWire,
  TextTypeWire,
  SmsDeliveryStatusWire,
  TextMessageOriginWire,
  PhoneIncomingCallWebhookPayload,
  CallStatusWire,
  HangupReasonWire,
  CallDirectionWire,
} from "./webhooks/types.js";
// Snake_case wire shapes referenced by the webhook payload types above.
// Re-exported from the root entry because package.json#exports only
// publishes `"."` and `"./tunnels/connect"` — deep imports of
// `phone/types.js` are not a valid public API.
export type {
  RawRateLimitInfo,
  RawTextMediaItem,
  RawTextMessageRecipient,
} from "./phone/types.js";
export {
  ContactRuleStatus,
  FilterMode,
  ForwardMode,
  MailRuleAction,
  MailRuleMatchType,
  MessageDirection,
  SendingDomainStatus,
  ThreadFolder,
} from "./mail/types.js";
export type {
  Domain,
  FilterModeChangeNotice,
  Mailbox,
  MailContactRule,
  Message,
  MessageDetail,
  Thread,
  ThreadDetail,
} from "./mail/types.js";
export {
  PhoneRuleAction,
  PhoneRuleMatchType,
  SmsDeliveryStatus,
  SmsOptInSource,
  SmsOptInStatus,
  SmsStatus,
  TextMessageOrigin,
} from "./phone/types.js";
export type {
  PhoneNumber,
  PhoneCall,
  PhoneCallWithRateLimit,
  PhoneContactRule,
  RateLimitInfo,
  PhoneTranscript,
  SmsOptIn,
  TextMediaItem,
  TextMessage,
  TextMessageRecipient,
  TextConversationSummary,
  TextConversationUpdateResult,
} from "./phone/types.js";
export type {
  AgentIdentitySummary,
  CreateIdentityOptions,
  IdentityAccess,
  IdentityMailboxCreateOptions,
  IdentityMailbox,
  IdentityPhoneNumberCreateOptions,
  IdentityPhoneNumber,
  IdentityTunnelCreateOptions,
} from "./identities/types.js";
export {
  HandleUnavailableError,
  type BlockingNamespace,
} from "./identities/exceptions.js";
export {
  validateAgentHandle,
  validateTunnelName,
  normalizeAgentHandle,
} from "./tunnels/_validation.js";
export type {
  Contact,
  ContactAccess,
  ContactAddress,
  ContactCustomField,
  ContactDate,
  ContactEmail,
  ContactImportResult,
  ContactImportResultItem,
  ContactPhone,
  ContactWebsite,
  CreateContactOptions,
  ListContactsOptions,
  LookupContactsOptions,
  UpdateContactOptions,
} from "./contacts/index.js";
export type { Note, NoteAccess } from "./notes/types.js";
export type {
  CreateNoteOptions,
  ListNotesOptions,
  UpdateNoteOptions,
} from "./notes/resources/notes.js";
export type {
  AccessRule,
  VaultInfo,
  VaultInitializeResult,
  VaultKey,
  VaultSecret,
  VaultSecretDetail,
  DecryptedVaultSecret,
  LoginPayload,
  OtherPayload,
  SSHKeyPayload,
  APIKeyPayload,
  KeyPairPayload,
  SecretPayload,
} from "./vault/types.js";
export { VaultSecretType, VaultKeyType } from "./vault/types.js";
export type { TOTPConfig, TOTPCode } from "./vault/totp.js";
export { TOTPAlgorithm, generateTotp, parseTotpUri } from "./vault/totp.js";
export type { VaultKeyMaterial } from "./vault/crypto.js";
export { UnlockedVault } from "./vault/resources/vault.js";
export {
  generateOrgEncryptionKey,
  generateVaultKeyMaterial,
  generateRecoveryCode,
  vaultKeyMaterialToWire,
} from "./vault/crypto.js";

// API keys
export type {
  ApiKey,
  ApiKeyStatus,
  CreatedApiKey,
} from "./api_keys/types.js";
export type { CreateApiKeyOptions } from "./api_keys/resources/apiKeys.js";

// Tunnels
export { TLSMode, TunnelStatus } from "./tunnels/types.js";
export type {
  SignedCert,
  Tunnel,
} from "./tunnels/types.js";
export type { UpdateTunnelOptions } from "./tunnels/resources/tunnels.js";
export {
  TunnelCSRStateConflict,
  TunnelError,
  TunnelNameInvalid,
  TunnelNotProvisioned,
  TunnelRemoved,
  TunnelStateConflict,
  TunnelTLSModeMismatch,
} from "./tunnels/exceptions.js";
