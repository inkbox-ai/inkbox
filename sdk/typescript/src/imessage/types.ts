/**
 * inkbox-imessage/types.ts
 *
 * Types mirroring the Inkbox iMessage API response models.
 *
 * iMessage routes by assignment, not by a number the org owns: a
 * recipient is connected to an agent identity over a shared pool line,
 * and every agent-facing shape is keyed by `conversationId` /
 * `remoteNumber`. The local pool number is never exposed.
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
 * An iMessage in an assignment-routed conversation.
 *
 * There is no local-number field: shared pool lines are hidden from
 * agents, so messages are identified by `conversationId` and the
 * counterparty `remoteNumber` only.
 */
export interface IMessage {
  id: string;
  conversationId: string;
  assignmentId: string;
  /** "inbound" | "outbound" */
  direction: string;
  remoteNumber: string;
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

/** One assignment-scoped iMessage conversation. */
export interface IMessageConversation {
  id: string;
  assignmentId: string;
  remoteNumber: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Conversation list row with latest-message preview. */
export interface IMessageConversationSummary {
  id: string;
  assignmentId: string;
  remoteNumber: string;
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
  assignmentId: string;
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
  assignment_id: string;
  direction: string;
  remote_number: string;
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
  assignment_id: string;
  remote_number: string;
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
  assignment_id: string;
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
    remoteNumber: r.remote_number,
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
    remoteNumber: r.remote_number,
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
