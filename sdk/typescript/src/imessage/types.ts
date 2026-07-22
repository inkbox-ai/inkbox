/**
 * inkbox-imessage/types.ts
 *
 * Types mirroring the Inkbox iMessage API response models.
 *
 * Conversations are keyed by `conversationId`. One-to-one rows also expose
 * assignment and remote-number state; dedicated-outbound groups instead expose
 * participant snapshots. Dedicated numbers are exposed through the numbers
 * resource.
 */

import { ContactRuleStatus } from "../mail/types.js";

/** Transport a message actually went over (iMessage may downgrade). */
export enum IMessageService {
  IMESSAGE = "imessage",
  SMS = "sms",
  RCS = "rcs",
}

/** Provider-facing delivery lifecycle for an iMessage. */
export enum IMessageDeliveryStatus {
  REGISTERED = "registered",
  PENDING = "pending",
  QUEUED = "queued",
  ACCEPTED = "accepted",
  SENT = "sent",
  DELIVERED = "delivered",
  DECLINED = "declined",
  ERROR = "error",
  RECEIVED = "received",
}

/**
 * Tapback reaction kinds.
 *
 * `CUSTOM` is inbound-only: recipients can react with any emoji
 * (carried in `customEmoji`), but sends accept the classic six.
 */
export enum IMessageReactionType {
  LOVE = "love",
  LIKE = "like",
  DISLIKE = "dislike",
  LAUGH = "laugh",
  EMPHASIZE = "emphasize",
  QUESTION = "question",
  CUSTOM = "custom",
}

/** Expressive send style applied to an outbound iMessage. */
export enum IMessageSendStyle {
  CELEBRATION = "celebration",
  SHOOTING_STAR = "shooting_star",
  FIREWORKS = "fireworks",
  LASERS = "lasers",
  LOVE = "love",
  CONFETTI = "confetti",
  BALLOONS = "balloons",
  SPOTLIGHT = "spotlight",
  ECHO = "echo",
  INVISIBLE = "invisible",
  GENTLE = "gentle",
  LOUD = "loud",
  SLAM = "slam",
}

/** Lifecycle of a recipient's triage-created connection to an agent. */
export enum IMessageAssignmentStatus {
  ACTIVE = "active",
  RELEASED = "released",
}

/** Lifecycle of a local group conversation's initial creation. */
export enum IMessageGroupCreationStatus {
  /** The initial remote group thread is still being created. */
  CREATING = "creating",
  /** No remote group thread is bound; the next send retries creation. */
  NOT_CREATED = "not_created",
  /** The remote group thread is bound and ready for sends. */
  READY = "ready",
}

/** Role of an iMessage number. */
export enum IMessageNumberType {
  DEDICATED_INBOUND = "dedicated_inbound",
  DEDICATED_OUTBOUND = "dedicated_outbound",
}

/** Dedicated variants accepted by self-serve number claiming. */
export type IMessageDedicatedNumberType =
  | IMessageNumberType.DEDICATED_INBOUND
  | IMessageNumberType.DEDICATED_OUTBOUND
  | "dedicated_inbound"
  | "dedicated_outbound";

/** Lifecycle state of an iMessage number. */
export enum IMessageNumberStatus {
  ACTIVE = "active",
  PAUSED = "paused",
}

/**
 * An organization-owned dedicated iMessage number.
 *
 * Unattached numbers have both attachment fields set to `null`. A dedicated
 * outbound number may initiate conversations; callers can test
 * `type === IMessageNumberType.DEDICATED_OUTBOUND`.
 */
export interface IMessageNumber {
  id: string;
  number: string;
  type: IMessageNumberType;
  status: IMessageNumberStatus;
  agentIdentityId: string | null;
  agentHandle: string | null;
}

/** Dedicated iMessage number embedded on a detailed identity response. */
export interface IdentityIMessageNumber {
  id: string;
  number: string;
  type: IMessageNumberType;
}

/** Whether a matching remote number is allowed through or blocked. */
export enum IMessageRuleAction {
  ALLOW = "allow",
  BLOCK = "block",
}

/** What an iMessage contact rule matches on. */
export enum IMessageRuleMatchType {
  EXACT_NUMBER = "exact_number",
}

/** Media attachment on an iMessage. */
export interface IMessageMediaItem {
  url: string;
  contentType: string | null;
  size: number | null;
}

/** Per-recipient outbound delivery state for an iMessage. */
export interface IMessageRecipient {
  remoteNumber: string;
  deliveryStatus: IMessageDeliveryStatus | null;
  service: IMessageService | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorReason: string | null;
  errorDetail: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
}

/** A live tapback attached to a message in read responses. */
export interface IMessageMessageReaction {
  id: string;
  /** "inbound" | "outbound" */
  direction: string;
  reaction: IMessageReactionType;
  /** Literal emoji when `reaction` is "custom"; null for the classic six. */
  customEmoji: string | null;
  remoteNumber: string;
  partIndex: number;
  createdAt: Date;
}

/**
 * An iMessage in a one-to-one or group conversation.
 *
 * Group rows have no assignment, carry a best-known participant snapshot,
 * and expose per-recipient outbound delivery state.
 */
export interface IMessage {
  id: string;
  conversationId: string;
  assignmentId: string | null;
  /** "inbound" | "outbound" */
  direction: string;
  remoteNumber: string | null;
  /** Sender for inbound group messages; null for outbound and one-to-one rows. */
  senderNumber: string | null;
  /** Best-known participant snapshot for a group message. */
  participants: string[] | null;
  isGroup: boolean;
  content: string | null;
  /** "message" | "carousel" */
  messageType: string;
  service: IMessageService;
  sendStyle: IMessageSendStyle | null;
  media: IMessageMediaItem[] | null;
  wasDowngraded: boolean | null;
  status: IMessageDeliveryStatus | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorReason: string | null;
  errorDetail: string | null;
  isRead: boolean;
  isBlocked: boolean;
  recipients: IMessageRecipient[] | null;
  /** Live (non-removed) tapbacks targeting this message, oldest first. */
  reactions: IMessageMessageReaction[] | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One iMessage conversation.
 *
 * One-to-one rows expose assignment state. Group rows have no assignment and
 * expose a best-known participant snapshot and creation lifecycle instead.
 */
export interface IMessageConversation {
  id: string;
  assignmentId: string | null;
  assignmentStatus: IMessageAssignmentStatus | null;
  remoteNumber: string | null;
  participants: string[] | null;
  isGroup: boolean;
  /** Group lifecycle; null for one-to-one conversations and older responses. */
  groupCreationStatus: IMessageGroupCreationStatus | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Conversation list row with latest-message preview. */
export interface IMessageConversationSummary {
  id: string;
  assignmentId: string | null;
  assignmentStatus: IMessageAssignmentStatus | null;
  remoteNumber: string | null;
  participants: string[] | null;
  isGroup: boolean;
  /** Group lifecycle; null for one-to-one conversations and older responses. */
  groupCreationStatus: IMessageGroupCreationStatus | null;
  latestText: string | null;
  latestMessageAt: Date | null;
  latestDirection: string | null;
  latestHasMedia: boolean;
  unreadCount: number;
  totalCount: number;
}

/** A tapback reaction on an iMessage. */
export interface IMessageReaction {
  id: string;
  conversationId: string;
  assignmentId: string | null;
  targetMessageId: string;
  /** "inbound" | "outbound" */
  direction: string;
  reaction: IMessageReactionType;
  /** Literal emoji when `reaction` is "custom"; null for the classic six. */
  customEmoji: string | null;
  remoteNumber: string;
  partIndex: number;
  createdAt: Date;
  updatedAt: Date;
}

/** An active connection between one recipient and one agent identity. */
export interface IMessageAssignment {
  id: string;
  remoteNumber: string;
  agentIdentityId: string;
  organizationId: string;
  status: IMessageAssignmentStatus;
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The active triage line and how recipients start a connection. */
export interface IMessageTriageNumber {
  number: string;
  connectCommand: string;
}

/** Result of marking a conversation's inbound messages read. */
export interface IMessageMarkReadResult {
  conversationId: string;
  updatedCount: number;
}

/** A reusable media URL returned by the iMessage media upload. */
export interface IMessageMediaUpload {
  mediaUrl: string;
  contentType: string | null;
  size: number | null;
}

/** An allow/block rule scoped to an agent identity for iMessage. */
export interface IMessageContactRule {
  id: string;
  agentIdentityId: string;
  action: IMessageRuleAction;
  matchType: IMessageRuleMatchType;
  matchTarget: string;
  status: ContactRuleStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ---- internal raw API shapes (snake_case from JSON) ----

export interface RawIMessageMediaItem {
  url: string;
  content_type?: string | null;
  size?: number | null;
}

export interface RawIMessageRecipient {
  remote_number: string;
  delivery_status?: string | null;
  service?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  error_reason?: string | null;
  error_detail?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  failed_at?: string | null;
}

export interface RawIMessageMessageReaction {
  id: string;
  direction: string;
  reaction: string;
  custom_emoji?: string | null;
  remote_number: string;
  part_index?: number;
  created_at: string;
}

export interface RawIMessage {
  id: string;
  conversation_id: string;
  assignment_id: string | null;
  direction: string;
  remote_number: string | null;
  sender_number?: string | null;
  participants?: string[] | null;
  is_group?: boolean;
  content?: string | null;
  message_type: string;
  service: string;
  send_style?: string | null;
  media?: RawIMessageMediaItem[] | null;
  was_downgraded?: boolean | null;
  status?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  error_reason?: string | null;
  error_detail?: string | null;
  is_read: boolean;
  is_blocked?: boolean;
  recipients?: RawIMessageRecipient[] | null;
  reactions?: RawIMessageMessageReaction[] | null;
  created_at: string;
  updated_at: string;
}

export interface RawIMessageConversation {
  id: string;
  assignment_id: string | null;
  assignment_status?: string | null;
  remote_number: string | null;
  participants?: string[] | null;
  is_group?: boolean;
  group_creation_status?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawIMessageAssignment {
  id: string;
  remote_number: string;
  agent_identity_id: string;
  organization_id: string;
  status: string;
  released_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawIMessageConversationSummary extends RawIMessageConversation {
  latest_text?: string | null;
  latest_message_at?: string | null;
  latest_direction?: string | null;
  latest_has_media?: boolean;
  unread_count?: number;
  total_count?: number;
}

export interface RawIMessageReaction {
  id: string;
  conversation_id: string;
  assignment_id: string | null;
  target_message_id: string;
  direction: string;
  reaction: string;
  custom_emoji?: string | null;
  remote_number: string;
  part_index?: number;
  created_at: string;
  updated_at: string;
}

export interface RawIMessageTriageNumber {
  number: string;
  connect_command: string;
}

export interface RawIMessageNumber {
  id: string;
  number: string;
  type: string;
  status: string;
  agent_identity_id: string | null;
  agent_handle: string | null;
}

export interface RawIdentityIMessageNumber {
  id: string;
  number: string;
  type: string;
}

export interface RawIMessageContactRule {
  id: string;
  agent_identity_id: string;
  action: string;
  match_type: string;
  match_target: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// ---- parsers ----

export function parseIMessageMediaItem(r: RawIMessageMediaItem): IMessageMediaItem {
  return {
    url: r.url,
    contentType: r.content_type ?? null,
    size: r.size ?? null,
  };
}

export function parseIMessageRecipient(r: RawIMessageRecipient): IMessageRecipient {
  return {
    remoteNumber: r.remote_number,
    deliveryStatus: (r.delivery_status as IMessageDeliveryStatus) ?? null,
    service: (r.service as IMessageService) ?? null,
    errorCode: r.error_code ?? null,
    errorMessage: r.error_message ?? null,
    errorReason: r.error_reason ?? null,
    errorDetail: r.error_detail ?? null,
    sentAt: r.sent_at ? new Date(r.sent_at) : null,
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
    failedAt: r.failed_at ? new Date(r.failed_at) : null,
  };
}

export function parseIMessageMessageReaction(
  r: RawIMessageMessageReaction,
): IMessageMessageReaction {
  return {
    id: r.id,
    direction: r.direction,
    reaction: r.reaction as IMessageReactionType,
    customEmoji: r.custom_emoji ?? null,
    remoteNumber: r.remote_number,
    partIndex: r.part_index ?? 0,
    createdAt: new Date(r.created_at),
  };
}

export function parseIMessage(r: RawIMessage): IMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    assignmentId: r.assignment_id,
    direction: r.direction,
    remoteNumber: r.remote_number,
    senderNumber: r.sender_number ?? null,
    participants: r.participants ?? null,
    isGroup: r.is_group ?? false,
    content: r.content ?? null,
    messageType: r.message_type,
    service: r.service as IMessageService,
    sendStyle: (r.send_style as IMessageSendStyle) ?? null,
    media: r.media ? r.media.map(parseIMessageMediaItem) : null,
    wasDowngraded: r.was_downgraded ?? null,
    status: (r.status as IMessageDeliveryStatus) ?? null,
    errorCode: r.error_code ?? null,
    errorMessage: r.error_message ?? null,
    errorReason: r.error_reason ?? null,
    errorDetail: r.error_detail ?? null,
    isRead: r.is_read,
    isBlocked: r.is_blocked ?? false,
    recipients: r.recipients ? r.recipients.map(parseIMessageRecipient) : null,
    reactions: r.reactions ? r.reactions.map(parseIMessageMessageReaction) : null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseIMessageConversation(
  r: RawIMessageConversation,
): IMessageConversation {
  return {
    id: r.id,
    assignmentId: r.assignment_id,
    assignmentStatus: r.assignment_status
      ? r.assignment_status as IMessageAssignmentStatus
      : (r.assignment_id ? IMessageAssignmentStatus.ACTIVE : null),
    remoteNumber: r.remote_number,
    participants: r.participants ?? null,
    isGroup: r.is_group ?? false,
    groupCreationStatus:
      (r.group_creation_status as IMessageGroupCreationStatus | null | undefined) ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseIMessageAssignment(r: RawIMessageAssignment): IMessageAssignment {
  return {
    id: r.id,
    remoteNumber: r.remote_number,
    agentIdentityId: r.agent_identity_id,
    organizationId: r.organization_id,
    status: r.status as IMessageAssignmentStatus,
    releasedAt: r.released_at ? new Date(r.released_at) : null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseIMessageConversationSummary(
  r: RawIMessageConversationSummary,
): IMessageConversationSummary {
  return {
    id: r.id,
    assignmentId: r.assignment_id,
    assignmentStatus: r.assignment_status
      ? r.assignment_status as IMessageAssignmentStatus
      : (r.assignment_id ? IMessageAssignmentStatus.ACTIVE : null),
    remoteNumber: r.remote_number,
    participants: r.participants ?? null,
    isGroup: r.is_group ?? false,
    groupCreationStatus:
      (r.group_creation_status as IMessageGroupCreationStatus | null | undefined) ?? null,
    latestText: r.latest_text ?? null,
    latestMessageAt: r.latest_message_at ? new Date(r.latest_message_at) : null,
    latestDirection: r.latest_direction ?? null,
    latestHasMedia: r.latest_has_media ?? false,
    unreadCount: r.unread_count ?? 0,
    totalCount: r.total_count ?? 0,
  };
}

export function parseIMessageReaction(r: RawIMessageReaction): IMessageReaction {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    assignmentId: r.assignment_id,
    targetMessageId: r.target_message_id,
    direction: r.direction,
    reaction: r.reaction as IMessageReactionType,
    customEmoji: r.custom_emoji ?? null,
    remoteNumber: r.remote_number,
    partIndex: r.part_index ?? 0,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseIMessageTriageNumber(
  r: RawIMessageTriageNumber,
): IMessageTriageNumber {
  return {
    number: r.number,
    connectCommand: r.connect_command,
  };
}

export function parseIMessageNumber(
  r: RawIMessageNumber,
): IMessageNumber {
  return {
    id: r.id,
    number: r.number,
    type: r.type as IMessageNumberType,
    status: r.status as IMessageNumberStatus,
    agentIdentityId: r.agent_identity_id,
    agentHandle: r.agent_handle,
  };
}

export function parseIdentityIMessageNumber(
  r: RawIdentityIMessageNumber,
): IdentityIMessageNumber {
  return {
    id: r.id,
    number: r.number,
    type: r.type as IMessageNumberType,
  };
}

export function parseIMessageContactRule(
  r: RawIMessageContactRule,
): IMessageContactRule {
  return {
    id: r.id,
    agentIdentityId: r.agent_identity_id,
    action: r.action as IMessageRuleAction,
    matchType: r.match_type as IMessageRuleMatchType,
    matchTarget: r.match_target,
    status: r.status as ContactRuleStatus,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}
