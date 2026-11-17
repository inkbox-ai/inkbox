import { randomUUID } from "node:crypto";
import {
  Inkbox,
  type AgentIdentity,
  type IMessage,
  type MailAttachmentInput,
  type MessageDetail,
  type TextMessage,
} from "@inkbox/sdk";

export type Credential = string | (() => string | Promise<string>);
export type InkboxRoute = { identityId: string } & (
  | {
      channel: "email";
      emailAddress: string;
      threadId: string;
      anchorMessageId?: string;
    }
  | { channel: "sms"; conversationId: string }
  | {
      channel: "imessage";
      conversationId: string;
      threadId?: string;
      replyToMessageId?: string;
      isGroup?: boolean;
    }
  | {
      channel: "slack";
      connectionId: string;
      conversationId: string;
      threadTs?: string;
    }
  | { channel: "a2a"; taskId: string }
  | { channel: "voice"; callId: string }
);
export interface TransportOptions {
  apiKey: Credential;
  agentHandle: string;
  baseUrl?: string;
}
export interface TransportAttachment {
  url?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  /** Serializable reference for authenticated downloads. */
  reference?:
    | { channel: "email"; messageId: string; filename: string }
    | { channel: "slack"; connectionId: string; fileId: string };
}
export interface TransportMessage {
  id: string;
  text: string;
  authorId: string;
  authorName?: string;
  isMe: boolean;
  createdAt: Date;
  attachments?: TransportAttachment[];
  raw: unknown;
}
export interface TransportPage {
  messages: TransportMessage[];
  nextCursor?: string;
}
export interface TransportSend {
  text: string;
  mediaUrls?: string[];
  attachments?: MailAttachmentInput[];
  idempotencyKey?: string;
  a2aIntent?: "progress" | "ask_caller" | "complete" | "fail";
}

export class UnsupportedChannelOperationError extends Error {
  constructor(operation: string, channel: InkboxRoute["channel"]) {
    super(`${operation} is not supported for ${channel}`);
    this.name = "UnsupportedChannelOperationError";
  }
}

/** SDK-backed operations, resolving credentials again for each operation. */
export class InkboxTransport {
  constructor(private readonly options: TransportOptions) {}

  private async session(): Promise<{
    client: Inkbox;
    identity: AgentIdentity;
  }> {
    const apiKey =
      typeof this.options.apiKey === "function"
        ? await this.options.apiKey()
        : this.options.apiKey;
    if (!apiKey) throw new Error("An Inkbox API key is required");
    const client = new Inkbox({ apiKey, baseUrl: this.options.baseUrl });
    const principal = await client.whoami();
    if (
      principal.authType !== "api_key" ||
      !principal.scope?.startsWith("agent_identity:")
    ) {
      throw new Error("Chat SDK requires an agent-scoped Inkbox API key");
    }
    const identity = await client.getIdentity(this.options.agentHandle);
    if (principal.scope !== `agent_identity:${identity.id}`) {
      throw new Error(
        "Inkbox API key does not belong to the configured identity",
      );
    }
    return { client, identity };
  }

  async identity(): Promise<AgentIdentity> {
    return (await this.session()).identity;
  }

  private async scope(route: InkboxRoute) {
    const { client, identity } = await this.session();
    if (route.identityId !== identity.id)
      throw new Error("Thread belongs to a different Inkbox identity");
    if (
      route.channel === "email" &&
      route.emailAddress !== identity.emailAddress
    ) {
      throw new Error("Thread belongs to a different Inkbox mailbox");
    }
    if (route.channel === "slack") {
      const { connections } = await client.slack.listConnections(identity.id);
      if (
        !connections.some(
          (connection) =>
            connection.id === route.connectionId &&
            connection.identityId === identity.id,
        )
      ) {
        throw new Error(
          "Thread belongs to a different Inkbox Slack connection",
        );
      }
    }
    return { client, identity };
  }

  async prepareEmailReply(
    route: Extract<InkboxRoute, { channel: "email" }>,
  ): Promise<Extract<InkboxRoute, { channel: "email" }>> {
    const { identity } = await this.scope(route);
    return this.emailReplyRoute(identity, route);
  }

  private async emailReplyRoute(
    identity: AgentIdentity,
    route: Extract<InkboxRoute, { channel: "email" }>,
  ): Promise<Extract<InkboxRoute, { channel: "email" }>> {
    let anchor = route.anchorMessageId;
    if (!anchor) {
      try {
        anchor = (await identity.getThread(route.threadId)).messages.at(-1)?.id;
      } catch (error) {
        if (!(
          error instanceof Error &&
          "statusCode" in error &&
          error.statusCode === 404
        ))
          throw error;
        anchor = route.threadId;
      }
    }
    if (!anchor) throw new Error("Email thread has no message to reply to");
    const message = await identity.getMessage(anchor);
    if ((message.threadId ?? message.id) !== route.threadId)
      throw new Error("Email reply anchor does not belong to this thread");
    return { ...route, anchorMessageId: anchor };
  }

  async send(
    route: InkboxRoute,
    input: TransportSend,
  ): Promise<{ id: string; raw: unknown }> {
    if (route.channel === "voice")
      throw new UnsupportedChannelOperationError(
        "Text replies; use placeCall explicitly",
        route.channel,
      );
    if (
      input.attachments?.length &&
      route.channel !== "email" &&
      route.channel !== "slack"
    )
      throw new UnsupportedChannelOperationError(
        "Email attachments",
        route.channel,
      );
    if (
      input.mediaUrls?.length &&
      route.channel !== "sms" &&
      route.channel !== "imessage"
    )
      throw new UnsupportedChannelOperationError(
        "Media URL attachments",
        route.channel,
      );
    const { client, identity } = await this.scope(route);
    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    switch (route.channel) {
      case "email": {
        const { anchorMessageId } = await this.emailReplyRoute(identity, route);
        const raw = await identity.replyAllEmail(anchorMessageId!, {
          bodyText: input.text,
          attachments: input.attachments,
          idempotencyKey,
        });
        return { id: raw.id, raw };
      }
      case "sms": {
        const raw = await identity.sendText({
          conversationId: route.conversationId,
          text: input.text,
          mediaUrls: input.mediaUrls,
          idempotencyKey,
        });
        return { id: raw.id, raw };
      }
      case "imessage": {
        let replyToMessageId = route.replyToMessageId;
        if (route.threadId && !replyToMessageId) {
          const thread = await identity.getIMessageConversationThread(
            route.conversationId,
            route.threadId,
            { limit: 1 },
          );
          replyToMessageId = thread.threadRootMessageId ?? undefined;
          if (!replyToMessageId)
            throw new Error("Cannot resolve the iMessage thread root");
        }
        const raw = await identity.sendIMessage({
          conversationId: route.conversationId,
          replyToMessageId,
          text: input.text,
          mediaUrls: input.mediaUrls,
          idempotencyKey,
        });
        return { id: raw.id, raw };
      }
      case "slack": {
        if (input.attachments?.length) {
          if (input.attachments.length !== 1)
            throw new Error("Send one Slack attachment per message");
          const file = input.attachments[0];
          const raw = await client.slack.uploadFile(route.connectionId, {
            conversationId: route.conversationId,
            threadTs: route.threadTs,
            filename: file.filename,
            contentBase64: file.contentBase64,
            initialComment: input.text || undefined,
            idempotencyKey,
          });
          assertOperation(raw);
          return { id: raw.messageTs ?? `inkbox-operation:${raw.id}`, raw };
        }
        const raw = await client.slack.sendMessage(route.connectionId, {
          conversationId: route.conversationId,
          threadTs: route.threadTs,
          text: input.text,
          idempotencyKey,
        });
        if (raw.status === "failed" || raw.status === "unknown")
          throw new Error(
            `Slack send ${raw.status}; action ${raw.id}. Inspect the action before retrying.`,
          );
        return { id: raw.messageTs ?? `inkbox-action:${raw.id}`, raw };
      }
      case "a2a": {
        const raw = await identity.a2aReply(route.taskId, {
          text: input.text,
          intent: input.a2aIntent ?? "progress",
        });
        const reply = raw.messages
          .filter((message) => message.role === "agent")
          .at(-1);
        return { id: reply?.id ?? raw.id, raw };
      }
    }
  }

  async history(
    route: InkboxRoute,
    options: {
      limit?: number;
      cursor?: string;
      direction?: "forward" | "backward";
    } = {},
  ): Promise<TransportPage> {
    if (route.channel === "slack" && route.threadTs) {
      const { client, identity } = await this.scope(route);
      const offset = options.cursor === undefined ? 0 : Number(options.cursor);
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error("Invalid history cursor");
      const { connections } = await client.slack.listConnections(identity.id);
      const botId = connections.find(
        (connection) => connection.id === route.connectionId,
      )?.botUserId;
      const messages: TransportMessage[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.slack.listMessages(
          route.connectionId,
          route.conversationId,
          { threadTs: route.threadTs, limit: 100, cursor },
        );
        messages.push(
          ...page.messages.map((row) =>
            slackMessage(row, route.connectionId, botId),
          ),
        );
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      messages.sort(chronological);
      const limit = Math.max(1, Math.min(100, options.limit ?? 50));
      const start =
        options.direction === "forward"
          ? offset
          : Math.max(0, messages.length - offset - limit);
      const end =
        options.direction === "forward"
          ? offset + limit
          : Math.max(0, messages.length - offset);
      return {
        messages: messages.slice(start, end),
        nextCursor:
          offset + limit < messages.length ? String(offset + limit) : undefined,
      };
    }
    if (options.direction === "forward") {
      const start = options.cursor === undefined ? 0 : Number(options.cursor);
      if (!Number.isSafeInteger(start) || start < 0)
        throw new Error("Invalid history cursor");
      const all: TransportMessage[] = [];
      let cursor: string | undefined;
      do {
        const page = await this.history(route, {
          limit: 100,
          cursor,
          direction: "backward",
        });
        all.push(...page.messages);
        cursor = page.nextCursor;
      } while (cursor);
      all.sort(chronological);
      const limit = Math.max(1, Math.min(100, options.limit ?? 50));
      return {
        messages: all.slice(start, start + limit),
        nextCursor:
          start + limit < all.length ? String(start + limit) : undefined,
      };
    }
    const { client, identity } = await this.scope(route);
    const limit = Math.max(1, Math.min(100, options.limit ?? 50));
    const offset = () => {
      const value = options.cursor === undefined ? 0 : Number(options.cursor);
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error("Invalid history cursor");
      return value;
    };
    switch (route.channel) {
      case "email": {
        let thread;
        try {
          thread = await identity.getThread(route.threadId);
        } catch (error) {
          if (!(
            error instanceof Error &&
            "statusCode" in error &&
            error.statusCode === 404
          ))
            throw error;
          const row = await identity.getMessage(route.threadId);
          if (row.threadId !== null) throw error;
          return { messages: options.cursor ? [] : [emailMessage(row)] };
        }
        const start = offset();
        const rows = [...thread.messages].reverse().slice(start, start + limit);
        const messages = await Promise.all(
          rows.map(async (row) =>
            emailMessage(await identity.getMessage(row.id)),
          ),
        );
        return {
          messages: messages.reverse(),
          nextCursor:
            start + limit < thread.messages.length
              ? String(start + limit)
              : undefined,
        };
      }
      case "sms": {
        const start = offset();
        const rows = await identity.getTextConversation(route.conversationId, {
          limit,
          offset: start,
        });
        return {
          messages: rows.map(textMessage).sort(chronological),
          nextCursor: rows.length === limit ? String(start + limit) : undefined,
        };
      }
      case "imessage": {
        const start = offset();
        const rows = await identity.listIMessages({
          conversationId: route.conversationId,
          threadId: route.threadId,
          includeGroups: true,
          limit,
          offset: start,
        });
        return {
          messages: rows.map(imessageMessage).sort(chronological),
          nextCursor: rows.length === limit ? String(start + limit) : undefined,
        };
      }
      case "slack": {
        const page = await client.slack.listMessages(
          route.connectionId,
          route.conversationId,
          { threadTs: route.threadTs, limit, cursor: options.cursor },
        );
        const { connections } = await client.slack.listConnections(identity.id);
        const botId = connections.find(
          (connection) => connection.id === route.connectionId,
        )?.botUserId;
        return {
          messages: page.messages
            .map((row) => slackMessage(row, route.connectionId, botId))
            .sort(chronological),
          nextCursor: page.nextCursor ?? undefined,
        };
      }
      case "a2a": {
        const page = await identity.a2aMessages({
          taskId: route.taskId,
          direction: "inbound",
          limit,
          cursor: options.cursor,
        });
        return {
          messages: page.items
            .map((row) => ({
              id: row.id,
              text: row.parts
                .map((part) =>
                  typeof part.text === "string"
                    ? part.text
                    : "data" in part
                      ? JSON.stringify(part.data)
                      : "",
                )
                .filter(Boolean)
                .join("\n"),
              authorId:
                row.role === "agent" ? identity.id : row.caller.identityId,
              isMe: row.role === "agent",
              createdAt: new Date(row.createdAt),
              raw: row,
            }))
            .sort(chronological),
          nextCursor: page.nextCursor ?? undefined,
        };
      }
      case "voice": {
        const rows = [
          ...(await identity.listTranscripts(route.callId)),
        ].reverse();
        const start = offset();
        const page = rows.slice(start, start + limit);
        return {
          messages: page
            .map((row) => ({
              id: row.id,
              text: row.text,
              authorId: row.phoneNumber ?? row.party,
              isMe: row.party === "local",
              createdAt: row.createdAt,
              raw: row,
            }))
            .sort(chronological),
          nextCursor:
            start + limit < rows.length ? String(start + limit) : undefined,
        };
      }
    }
  }

  private async slackMessageId(
    client: Inkbox,
    route: Extract<InkboxRoute, { channel: "slack" }>,
    id: string,
  ): Promise<string> {
    const pending = id.startsWith("inkbox-action:")
      ? await client.slack.getAction(
          route.connectionId,
          id.slice("inkbox-action:".length),
        )
      : id.startsWith("inkbox-operation:")
        ? await client.slack.getOperation(
            route.connectionId,
            id.slice("inkbox-operation:".length),
          )
        : undefined;
    if (!pending) return id;
    if (
      pending.conversationId !== route.conversationId ||
      (route.threadTs && pending.threadTs !== route.threadTs)
    )
      throw new Error("Slack action belongs to a different thread");
    if (
      (pending.status !== "sent" && pending.status !== "succeeded") ||
      !pending.messageTs
    )
      throw new Error(
        `Slack action ${pending.id} is ${pending.status}; no message timestamp is available. Inspect the action before retrying.`,
      );
    return pending.messageTs;
  }

  async getMessage(route: InkboxRoute, id: string): Promise<TransportMessage> {
    const { client, identity } = await this.scope(route);
    if (route.channel === "slack") {
      const row = await client.slack.getMessage(
        route.connectionId,
        route.conversationId,
        await this.slackMessageId(client, route, id),
        { threadTs: route.threadTs },
      );
      const { connections } = await client.slack.listConnections(identity.id);
      return slackMessage(
        row,
        route.connectionId,
        connections.find((connection) => connection.id === route.connectionId)
          ?.botUserId,
      );
    }
    if (route.channel === "email") {
      const row = await identity.getMessage(id);
      if ((row.threadId ?? row.id) !== route.threadId)
        throw new Error("Message does not belong to this thread");
      return emailMessage(row);
    }
    if (route.channel === "sms") {
      const row = await identity.getText(id);
      if (row.conversationId !== route.conversationId)
        throw new Error("Message does not belong to this conversation");
      return textMessage(row);
    }
    if (route.channel === "imessage") {
      const row = await identity.getIMessage(id);
      if (
        row.conversationId !== route.conversationId ||
        (route.threadId && row.threadId !== route.threadId)
      )
        throw new Error("Message does not belong to this thread");
      return imessageMessage(row);
    }
    let cursor: string | undefined;
    do {
      const page = await this.history(route, { limit: 100, cursor });
      const message = page.messages.find((row) => row.id === id);
      if (message) return message;
      cursor = page.nextCursor;
    } while (cursor);
    throw new Error("Message not found in this thread");
  }

  async typing(route: InkboxRoute): Promise<void> {
    if (route.channel !== "imessage" || route.isGroup) return;
    const { identity } = await this.scope(route);
    try {
      await identity.sendIMessageTyping(route.conversationId);
    } catch (error) {
      if (
        error instanceof Error &&
        "statusCode" in error &&
        (error.statusCode === 409 || error.statusCode === 422)
      )
        return;
      throw error;
    }
  }

  async markRead(route: InkboxRoute): Promise<void> {
    const { identity } = await this.scope(route);
    switch (route.channel) {
      case "email":
        await identity.markEmailsRead(
          (await identity.getThread(route.threadId)).messages.map(
            (message) => message.id,
          ),
        );
        return;
      case "sms":
        await identity.markTextConversationRead(route.conversationId);
        return;
      case "imessage":
        if (!route.isGroup)
          await identity.markIMessageConversationRead(route.conversationId);
        return;
      default:
        throw new UnsupportedChannelOperationError(
          "Read receipts",
          route.channel,
        );
    }
  }

  async addReaction(
    route: InkboxRoute,
    messageId: string,
    reaction: string,
  ): Promise<void> {
    if (route.channel === "slack") {
      const { client } = await this.scope(route);
      assertOperation(
        await client.slack.addReaction(
          route.connectionId,
          route.conversationId,
          await this.slackMessageId(client, route, messageId),
          reaction,
          { idempotencyKey: randomUUID() },
        ),
      );
      return;
    }
    if (route.channel !== "imessage")
      throw new UnsupportedChannelOperationError("Reactions", route.channel);
    await this.getMessage(route, messageId);
    const { identity } = await this.scope(route);
    await identity.sendIMessageReaction({ messageId, reaction });
  }

  async removeReaction(
    route: InkboxRoute,
    messageId: string,
    reaction: string,
  ): Promise<void> {
    if (route.channel === "slack") {
      const { client } = await this.scope(route);
      assertOperation(
        await client.slack.removeReaction(
          route.connectionId,
          route.conversationId,
          await this.slackMessageId(client, route, messageId),
          reaction,
          { idempotencyKey: randomUUID() },
        ),
      );
      return;
    }
    if (route.channel !== "imessage")
      throw new UnsupportedChannelOperationError("Reactions", route.channel);
    await this.getMessage(route, messageId);
    const { identity } = await this.scope(route);
    const message = await identity.getIMessage(messageId);
    for (const item of message.reactions ?? []) {
      if (item.direction === "outbound" && item.reaction === reaction)
        await identity.removeIMessageReaction(item.id);
    }
  }

  async editMessage(
    route: InkboxRoute,
    messageId: string,
    text: string,
  ): Promise<{ id: string; raw: unknown }> {
    if (route.channel !== "slack")
      throw new UnsupportedChannelOperationError(
        "Editing messages",
        route.channel,
      );
    const { client } = await this.scope(route);
    const raw = await client.slack.updateMessage(
      route.connectionId,
      route.conversationId,
      await this.slackMessageId(client, route, messageId),
      text,
      { idempotencyKey: randomUUID() },
    );
    assertOperation(raw);
    return { id: raw.messageTs ?? messageId, raw };
  }

  async deleteMessage(route: InkboxRoute, messageId: string): Promise<void> {
    if (route.channel !== "slack")
      throw new UnsupportedChannelOperationError(
        "Deleting messages",
        route.channel,
      );
    const { client } = await this.scope(route);
    assertOperation(
      await client.slack.deleteMessage(
        route.connectionId,
        route.conversationId,
        await this.slackMessageId(client, route, messageId),
        { idempotencyKey: randomUUID() },
      ),
    );
  }

  async placeCall(options: Parameters<AgentIdentity["placeCall"]>[0]) {
    return (await this.identity()).placeCall(options);
  }

  async uploadMedia(
    options: Parameters<AgentIdentity["uploadIMessageMedia"]>[0],
  ) {
    return (await this.identity()).uploadIMessageMedia(options);
  }

  async attachment(
    route: InkboxRoute,
    reference: NonNullable<TransportAttachment["reference"]>,
  ): Promise<Uint8Array | string> {
    if (
      !reference ||
      typeof reference !== "object" ||
      (reference.channel !== "email" && reference.channel !== "slack")
    )
      throw new Error("Invalid attachment reference");
    if (
      reference.channel === "email" &&
      (typeof reference.messageId !== "string" ||
        !reference.messageId ||
        typeof reference.filename !== "string" ||
        !reference.filename)
    )
      throw new Error("Invalid email attachment reference");
    if (
      reference.channel === "slack" &&
      (typeof reference.connectionId !== "string" ||
        !reference.connectionId ||
        typeof reference.fileId !== "string" ||
        !reference.fileId)
    )
      throw new Error("Invalid Slack attachment reference");
    const { client, identity } = await this.scope(route);
    if (reference.channel === "email" && route.channel === "email") {
      const row = await identity.getMessage(reference.messageId);
      if ((row.threadId ?? row.id) !== route.threadId)
        throw new Error("Attachment does not belong to this thread");
      return (
        await client.messages.getAttachment(
          route.emailAddress,
          reference.messageId,
          reference.filename,
        )
      ).url;
    }
    if (
      reference.channel === "slack" &&
      route.channel === "slack" &&
      reference.connectionId === route.connectionId
    ) {
      return client.slack.downloadFile(
        reference.connectionId,
        reference.fileId,
      );
    }
    throw new Error("Attachment does not belong to this channel");
  }
}

function chronological(a: TransportMessage, b: TransportMessage) {
  return a.createdAt.getTime() - b.createdAt.getTime();
}
export function emailMessage(row: MessageDetail): TransportMessage {
  return {
    id: row.id,
    text: row.bodyText ?? row.snippet ?? "",
    authorId: row.fromAddress,
    authorName: row.fromDisplayName ?? undefined,
    isMe: row.direction === "outbound",
    createdAt: row.createdAt,
    attachments: (row.attachmentMetadata ?? []).flatMap((attachment) =>
      typeof attachment.filename === "string"
        ? [
            {
              name: attachment.filename,
              mimeType:
                typeof attachment.content_type === "string"
                  ? attachment.content_type
                  : undefined,
              size:
                typeof attachment.size === "number"
                  ? attachment.size
                  : undefined,
              reference: {
                channel: "email" as const,
                messageId: row.id,
                filename: attachment.filename,
              },
            },
          ]
        : [],
    ),
    raw: row,
  };
}
export function textMessage(row: TextMessage): TransportMessage {
  return {
    id: row.id,
    text: row.text ?? "",
    authorId:
      row.direction === "outbound"
        ? row.localPhoneNumber
        : (row.senderPhoneNumber ?? row.remotePhoneNumber ?? "unknown"),
    isMe: row.direction === "outbound",
    createdAt: row.createdAt,
    attachments: (row.media ?? []).map((media) => ({
      url: media.url,
      mimeType: media.contentType,
      size: media.size,
    })),
    raw: row,
  };
}
export function imessageMessage(row: IMessage): TransportMessage {
  return {
    id: row.id,
    text: row.content ?? "",
    authorId:
      row.direction === "outbound"
        ? "self"
        : (row.senderNumber ?? row.remoteNumber ?? "unknown"),
    isMe: row.direction === "outbound",
    createdAt: row.createdAt,
    attachments: (row.media ?? []).map((media) => ({
      url: media.url,
      mimeType: media.contentType ?? undefined,
      size: media.size ?? undefined,
    })),
    raw: row,
  };
}

function assertOperation(result: { status: string; id: string }): void {
  if (result.status === "failed" || result.status === "unknown")
    throw new Error(
      `Slack operation ${result.status}; operation ${result.id}. Inspect the operation before retrying.`,
    );
}
function slackMessage(
  row: Record<string, unknown>,
  connectionId: string,
  botId?: string,
): TransportMessage {
  const files = Array.isArray(row.files)
    ? (row.files as Record<string, unknown>[])
    : [];
  return {
    id: String(row.ts),
    text: String(row.text ?? ""),
    authorId: String(row.user ?? row.bot_id ?? "unknown"),
    isMe: typeof botId === "string" && row.user === botId,
    createdAt: new Date(Number(row.ts) * 1000),
    attachments: files
      .filter((file) => typeof file.id === "string")
      .map((file) => ({
        name: typeof file.name === "string" ? file.name : undefined,
        mimeType: typeof file.mimetype === "string" ? file.mimetype : undefined,
        size: typeof file.size === "number" ? file.size : undefined,
        reference: {
          channel: "slack" as const,
          connectionId,
          fileId: String(file.id),
        },
      })),
    raw: row,
  };
}
