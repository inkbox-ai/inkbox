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
export type { SigningKey, SigningKeyStatus } from "./signing_keys.js";
export { verifyWebhook } from "./signing_keys.js";
export type {
  WebhookContact,
  WebhookMailContact,
  WebhookAgentIdentity,
  WebhookMailAgentIdentity,
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
  IMessageWebhookPayload,
  IMessageWebhookEventType,
  IMessageWebhookMessage,
  IMessageWebhookReaction,
  IMessageDirectionWire,
  IMessageServiceWire,
  IMessageTypeWire,
  IMessageDeliveryStatusWire,
  IMessageReactionTypeWire,
  IMessageSendStyleWire,
  IMessageMediaItemWire,
  IMessageMessageReactionWire,
  IMessageRecipientWire,
  PhoneIncomingCallWebhookPayload,
  CallStatusWire,
  HangupReasonWire,
  CallDirectionWire,
  WebhookContext,
  WebhookContextBlock,
  WebhookContextMailItem,
  WebhookContextTextItem,
  WebhookContextCallItem,
  WebhookTranscriptEntry,
  WebhookContextScopeWire,
  WebhookContextModeWire,
  WebhookContextSkipReasonWire,
  WebhookContextTextChannelWire,
} from "./webhooks/types.js";
export type {
  WebhookSubscription,
  WebhookSubscriptionCreateResponse,
  WebhookSubscriptionStatus,
  WebhookContextConfig,
  WebhookContextClassConfig,
  CreateWebhookSubscriptionOptions,
  UpdateWebhookSubscriptionOptions,
  ListWebhookSubscriptionsOptions,
} from "./webhooks/subscriptions.js";
export type { WebhookSubscriptionsResource } from "./webhooks/subscriptions.js";
export type {
  WebhookDelivery,
  ListWebhookDeliveriesOptions,
} from "./webhooks/deliveries.js";
export type { WebhookDeliveriesResource } from "./webhooks/deliveries.js";
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
  MailIdentityContactRule,
  Message,
  MessageDetail,
  ReplyAllRecipients,
  Thread,
  ThreadDetail,
} from "./mail/types.js";
export type {
  MailIdentityContactRulesResource,
  CreateMailIdentityContactRuleOptions,
  ListMailIdentityContactRulesOptions,
  ListAllMailIdentityContactRulesOptions,
  UpdateMailIdentityContactRuleOptions,
} from "./mail/resources/identityContactRules.js";
export {
  CallOrigin,
  IncomingCallAction,
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
  PhoneIdentityContactRule,
  IncomingCallActionConfig,
  RateLimitInfo,
  PhoneTranscript,
  SmsOptIn,
  TextMediaItem,
  TextMessage,
  TextMessageRecipient,
  TextConversationSummary,
  TextConversationUpdateResult,
} from "./phone/types.js";
export type { IncomingCallActionResource } from "./phone/resources/incomingCallAction.js";
export type {
  PhoneIdentityContactRulesResource,
  CreatePhoneIdentityContactRuleOptions,
  ListPhoneIdentityContactRulesOptions,
  ListAllPhoneIdentityContactRulesOptions,
  UpdatePhoneIdentityContactRuleOptions,
} from "./phone/resources/identityContactRules.js";
export {
  IMessageAssignmentStatus,
  IMessageDeliveryStatus,
  IMessageReactionType,
  IMessageRuleAction,
  IMessageRuleMatchType,
  IMessageSendStyle,
  IMessageService,
} from "./imessage/types.js";
export type {
  IMessage,
  IMessageAssignment,
  IMessageContactRule,
  IMessageConversation,
  IMessageConversationSummary,
  IMessageMarkReadResult,
  IMessageMediaItem,
  IMessageMediaUpload,
  IMessageMessageReaction,
  IMessageReaction,
  IMessageRecipient,
  IMessageTriageNumber,
} from "./imessage/types.js";
export type {
  IMessagesResource,
} from "./imessage/resources/imessages.js";
export type {
  IMessageContactRulesResource,
  CreateIMessageContactRuleOptions,
  ListIMessageContactRulesOptions,
  ListAllIMessageContactRulesOptions,
  UpdateIMessageContactRuleOptions,
} from "./imessage/resources/contactRules.js";
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
