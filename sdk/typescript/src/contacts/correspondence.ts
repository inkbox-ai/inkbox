export type CorrespondenceChannel = "email" | "sms" | "imessage" | "calls";
export type CorrespondenceContentMode = "metadata" | "preview" | "full";
export type CorrespondenceTranscriptMode = "none" | "abridged" | "full";
export type CorrespondenceOrder = "asc" | "desc";
export type CorrespondenceChannelStatus = "available" | "no_identifier" | "no_resource";
export type CorrespondenceDirection = "inbound" | "outbound";

export interface CorrespondenceMediaMetadata {
  count: number;
}

export interface CorrespondenceAttachmentMetadata {
  filename: string | null;
  contentType: string | null;
  size: number | null;
}

export interface CorrespondenceTranscriptEntry {
  id: string | null;
  seq: number | null;
  party: string | null;
  text: string | null;
  tsMs: number | null;
  marker: "abridged" | null;
  omittedTurns: number | null;
  omittedMs: number | null;
}

export interface CorrespondenceItemBase {
  sourceId: string;
  direction: CorrespondenceDirection;
  occurredAt: Date;
  identityId: string;
  status: string | null;
  detailUrl: string | null;
}

export interface EmailCorrespondenceItem extends CorrespondenceItemBase {
  channel: "email";
  mailboxEmail: string;
  threadId: string | null;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  contentUnavailable: boolean;
  attachments: CorrespondenceAttachmentMetadata[];
}

export interface SmsCorrespondenceItem extends CorrespondenceItemBase {
  channel: "sms";
  conversationId: string;
  localResourceId: string;
  localPhoneNumber: string;
  senderPhoneNumber: string | null;
  participants: string[];
  matchedContactPhone: string;
  isGroup: boolean;
  text: string | null;
  media: CorrespondenceMediaMetadata | null;
}

export interface IMessageCorrespondenceItem extends CorrespondenceItemBase {
  channel: "imessage";
  conversationId: string;
  remoteHandle: string;
  service: string;
  text: string | null;
  media: CorrespondenceMediaMetadata | null;
}

export interface CallCorrespondenceItem extends CorrespondenceItemBase {
  channel: "calls";
  remotePhoneNumber: string;
  localPhoneNumber: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  transcript: CorrespondenceTranscriptEntry[] | null;
  transcriptAbridged: boolean;
  transcriptUnavailable: boolean;
}

export type CorrespondenceItem =
  | EmailCorrespondenceItem
  | SmsCorrespondenceItem
  | IMessageCorrespondenceItem
  | CallCorrespondenceItem;

export interface CorrespondenceChannelResult {
  channel: CorrespondenceChannel;
  status: CorrespondenceChannelStatus;
  returned: number;
}

export interface ContactCorrespondence {
  contactId: string;
  identityId: string;
  items: CorrespondenceItem[];
  channels: CorrespondenceChannelResult[];
  nextCursor: string | null;
}

interface RawCorrespondenceItemBase {
  source_id: string;
  direction: CorrespondenceDirection;
  occurred_at: string;
  identity_id: string;
  status: string | null;
  detail_url: string | null;
}

export interface RawEmailCorrespondenceItem extends RawCorrespondenceItemBase {
  channel: "email";
  mailbox_email: string;
  thread_id: string | null;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  bcc_addresses: string[];
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  content_unavailable: boolean;
  attachments: Array<{
    filename: string | null;
    content_type: string | null;
    size: number | null;
  }>;
}

export interface RawSmsCorrespondenceItem extends RawCorrespondenceItemBase {
  channel: "sms";
  conversation_id: string;
  local_resource_id: string;
  local_phone_number: string;
  sender_phone_number: string | null;
  participants: string[];
  matched_contact_phone: string;
  is_group: boolean;
  text: string | null;
  media: CorrespondenceMediaMetadata | null;
}

export interface RawIMessageCorrespondenceItem extends RawCorrespondenceItemBase {
  channel: "imessage";
  conversation_id: string;
  remote_handle: string;
  service: string;
  text: string | null;
  media: CorrespondenceMediaMetadata | null;
}

export interface RawCallCorrespondenceItem extends RawCorrespondenceItemBase {
  channel: "calls";
  remote_phone_number: string;
  local_phone_number: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  transcript: Array<{
    id: string | null;
    seq: number | null;
    party: string | null;
    text: string | null;
    ts_ms: number | null;
    marker: "abridged" | null;
    omitted_turns: number | null;
    omitted_ms: number | null;
  }> | null;
  transcript_abridged: boolean;
  transcript_unavailable: boolean;
}

export type RawCorrespondenceItem =
  | RawEmailCorrespondenceItem
  | RawSmsCorrespondenceItem
  | RawIMessageCorrespondenceItem
  | RawCallCorrespondenceItem;

export interface RawContactCorrespondence {
  contact_id: string;
  identity_id: string;
  items: RawCorrespondenceItem[];
  channels: Array<{
    channel: CorrespondenceChannel;
    status: CorrespondenceChannelStatus;
    returned: number;
  }>;
  next_cursor: string | null;
}

function parseBase(r: RawCorrespondenceItemBase): CorrespondenceItemBase {
  return {
    sourceId: r.source_id,
    direction: r.direction,
    occurredAt: new Date(r.occurred_at),
    identityId: r.identity_id,
    status: r.status,
    detailUrl: r.detail_url,
  };
}

export function parseCorrespondenceItem(r: RawCorrespondenceItem): CorrespondenceItem {
  const base = parseBase(r);
  switch (r.channel) {
    case "email":
      return {
        ...base,
        channel: r.channel,
        mailboxEmail: r.mailbox_email,
        threadId: r.thread_id,
        fromAddress: r.from_address,
        toAddresses: r.to_addresses,
        ccAddresses: r.cc_addresses,
        bccAddresses: r.bcc_addresses,
        subject: r.subject,
        snippet: r.snippet,
        bodyText: r.body_text,
        contentUnavailable: r.content_unavailable,
        attachments: r.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.content_type,
          size: a.size,
        })),
      };
    case "sms":
      return {
        ...base,
        channel: r.channel,
        conversationId: r.conversation_id,
        localResourceId: r.local_resource_id,
        localPhoneNumber: r.local_phone_number,
        senderPhoneNumber: r.sender_phone_number,
        participants: r.participants,
        matchedContactPhone: r.matched_contact_phone,
        isGroup: r.is_group,
        text: r.text,
        media: r.media,
      };
    case "imessage":
      return {
        ...base,
        channel: r.channel,
        conversationId: r.conversation_id,
        remoteHandle: r.remote_handle,
        service: r.service,
        text: r.text,
        media: r.media,
      };
    case "calls":
      return {
        ...base,
        channel: r.channel,
        remotePhoneNumber: r.remote_phone_number,
        localPhoneNumber: r.local_phone_number,
        startedAt: r.started_at ? new Date(r.started_at) : null,
        endedAt: r.ended_at ? new Date(r.ended_at) : null,
        durationSeconds: r.duration_seconds,
        transcript: r.transcript?.map((t) => ({
          id: t.id,
          seq: t.seq,
          party: t.party,
          text: t.text,
          tsMs: t.ts_ms,
          marker: t.marker,
          omittedTurns: t.omitted_turns,
          omittedMs: t.omitted_ms,
        })) ?? null,
        transcriptAbridged: r.transcript_abridged,
        transcriptUnavailable: r.transcript_unavailable,
      };
  }
}

export function parseContactCorrespondence(r: RawContactCorrespondence): ContactCorrespondence {
  return {
    contactId: r.contact_id,
    identityId: r.identity_id,
    items: r.items.map(parseCorrespondenceItem),
    channels: r.channels,
    nextCursor: r.next_cursor,
  };
}
