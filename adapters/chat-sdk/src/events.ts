import type { Attachment } from "chat";
import type { InkboxRoute } from "./transport.js";

export const INKBOX_CHAT_EVENTS = [
  "message.received",
  "text.received",
  "imessage.received",
  "slack.dm_received",
  "slack.group_dm_received",
  "slack.channel_message_received",
  "slack.mention_received",
  "slack.thread_reply_received",
  "a2a.task.created",
  "a2a.task.message",
  "call.ended",
] as const;

export interface InkboxMessage {
  route: InkboxRoute;
  id: string;
  text: string;
  authorId: string;
  authorName?: string;
  isMe: boolean;
  createdAt: Date | string;
  attachments?: Attachment[];
  event?: Record<string, unknown>;
  isMention?: boolean;
  raw?: unknown;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a webhook object");
  }
  return value as Record<string, unknown>;
}
export function required(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Missing ${name}`);
  return value;
}
function optional(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
function media(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(object)
    .filter((m) => typeof m.url === "string")
    .map((m) => {
      const mimeType = optional(m.content_type);
      const kind = mimeType?.split("/")[0];
      return {
        type:
          kind === "image" || kind === "video" || kind === "audio"
            ? kind
            : "file",
        url: required(m.url, "media URL"),
        mimeType,
        size: typeof m.size === "number" ? m.size : undefined,
      };
    });
}

/** Normalize only conversation inputs; delivery receipts never become new turns. */
export function normalizeEvent(
  value: unknown,
  identity: { id: string; emailAddress: string | null },
): InkboxMessage | null {
  const event = object(value);
  const type = required(event.event_type, "event_type");
  if (!(INKBOX_CHAT_EVENTS as readonly string[]).includes(type)) return null;
  required(event.id, "event id");
  const timestamp = required(event.timestamp, "timestamp");
  if (!Number.isFinite(Date.parse(timestamp)))
    throw new Error("Invalid event timestamp");
  const data = object(event.data);
  const base = { identityId: identity.id };
  let route: InkboxRoute;
  let record: Record<string, unknown>;
  let text = "";
  let authorId: string;
  let id: string;
  let attachments: Attachment[] = [];
  let isMention = true;
  if (type === "message.received") {
    record = object(data.message);
    if (record.direction !== "inbound") return null;
    const emailAddress =
      optional(record.email_address) ?? identity.emailAddress;
    if (!emailAddress) throw new Error("Email address is required");
    if (
      identity.emailAddress &&
      emailAddress.toLowerCase() !== identity.emailAddress.toLowerCase()
    ) {
      throw new Error("Webhook mailbox does not match the configured identity");
    }
    id = required(record.id, "message id");
    route = {
      ...base,
      channel: "email",
      emailAddress,
      threadId: optional(record.thread_id) ?? id,
      anchorMessageId: id,
    };
    text = optional(record.body) ?? optional(record.snippet) ?? "";
    authorId = required(record.from_address, "sender");
  } else if (type === "text.received") {
    record = object(data.text_message);
    if (record.direction !== "inbound") return null;
    id = required(record.id, "message id");
    route = {
      ...base,
      channel: "sms",
      conversationId: required(record.conversation_id, "conversation id"),
    };
    text = optional(record.text) ?? "";
    authorId = required(
      record.sender_phone_number ?? record.remote_phone_number,
      "sender",
    );
    attachments = media(record.media);
  } else if (type === "imessage.received") {
    record = object(data.message);
    if (record.direction !== "inbound") return null;
    id = required(record.id, "message id");
    route = {
      ...base,
      channel: "imessage",
      conversationId: required(record.conversation_id, "conversation id"),
      threadId: optional(record.thread_id),
      replyToMessageId: optional(record.thread_root_message_id),
      isGroup: record.is_group === true,
    };
    text = optional(record.content) ?? "";
    authorId = required(record.sender_number ?? record.remote_number, "sender");
    attachments = media(record.media);
  } else if (type.startsWith("slack.")) {
    if (required(data.identity_id, "identity id") !== identity.id)
      throw new Error("Webhook identity mismatch");
    record = object(data.event);
    if (record.bot_id || object(data.actor_profile ?? {}).is_bot === true)
      return null;
    id = required(data.message_ts, "message timestamp");
    route = {
      ...base,
      channel: "slack",
      connectionId: required(data.connection_id, "connection id"),
      conversationId: required(data.conversation_id, "conversation id"),
      threadTs: optional(data.thread_ts) ?? id,
    };
    text = optional(record.text) ?? "";
    authorId = required(data.actor_id, "actor id");
    const files = Array.isArray(record.files) ? record.files.map(object) : [];
    attachments = files
      .filter((file) => typeof file.id === "string")
      .map((file) => {
        const mimeType = optional(file.mimetype);
        const kind = mimeType?.split("/")[0];
        return {
          type:
            kind === "image" || kind === "video" || kind === "audio"
              ? kind
              : "file",
          name: optional(file.name) ?? optional(file.title),
          mimeType,
          size: typeof file.size === "number" ? file.size : undefined,
          fetchMetadata: {
            reference: JSON.stringify({
              channel: "slack",
              connectionId: data.connection_id,
              fileId: file.id,
            }),
          },
        };
      });
    isMention =
      type === "slack.mention_received" ||
      type === "slack.dm_received" ||
      type === "slack.group_dm_received";
  } else if (type.startsWith("a2a.")) {
    record = data;
    route = {
      ...base,
      channel: "a2a",
      taskId: required(data.task_id, "task id"),
    };
    id = optional(data.message_id) ?? required(event.id, "event id");
    const parts = Array.isArray(data.parts) ? data.parts.map(object) : [];
    text = parts
      .map((part) => {
        if (typeof part.text === "string") return part.text;
        if (part.data !== undefined) return JSON.stringify(part.data);
        return "[Unsupported message part]";
      })
      .join("\n");
    authorId = required(
      object(data.sender ?? data.caller).identity_id,
      "caller identity",
    );
    if (authorId === identity.id) return null;
  } else {
    record = object(data.call);
    id = required(record.id, "call id");
    route = { ...base, channel: "voice", callId: id };
    const transcript = data.transcript == null ? {} : object(data.transcript);
    const entries = Array.isArray(transcript.entries)
      ? transcript.entries.map(object)
      : [];
    text = entries
      .map((entry) => {
        if (entry.marker === "abridged") {
          const count =
            typeof entry.omitted_turns === "number"
              ? `${entry.omitted_turns} turns`
              : "turns";
          return `[Transcript abridged: ${count} omitted]`;
        }
        const suffix = entry.truncated === true ? " [turn truncated]" : "";
        return `${optional(entry.party) ?? "speaker"}: ${optional(entry.text) ?? ""}${suffix}`;
      })
      .join("\n");
    if (
      transcript.abridged === true &&
      !entries.some((entry) => entry.marker === "abridged")
    ) {
      text += "\n[Transcript abridged]";
    }
    text = `Call ${optional(record.direction) ?? ""} ${optional(record.status) ?? "ended"}\n${text}`;
    authorId = required(record.remote_phone_number, "caller number");
  }
  return {
    route,
    id,
    text,
    authorId,
    isMe: false,
    createdAt: optional(record.created_at) ?? timestamp,
    attachments,
    event,
    isMention,
  };
}
