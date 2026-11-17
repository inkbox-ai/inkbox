import { createHash, randomUUID } from "node:crypto";
import { verifyWebhook } from "@inkbox/sdk";
import {
  Message,
  defaultEmojiResolver,
  NotImplementedError,
  parseMarkdown,
  stringifyMarkdown,
  type Adapter,
  type AdapterPostableMessage,
  type Attachment,
  type ChatInstance,
  type EmojiValue,
  type FetchOptions,
  type FormattedContent,
  type WebhookOptions,
} from "chat";
import {
  cardToFallbackText,
  downloadAttachment,
  extractCard,
} from "@chat-adapter/shared";
import {
  normalizeEvent,
  object,
  required,
  type InkboxMessage,
} from "./events.js";
import {
  InkboxTransport,
  UnsupportedChannelOperationError,
  type Credential,
  type InkboxRoute,
  type TransportAttachment,
  type TransportMessage,
  type TransportOptions,
  type TransportSend,
} from "./transport.js";

export interface InkboxAdapterOptions extends TransportOptions {
  signingSecret: Credential;
  /** Optional application admission hook. Sender access does not imply command authority. */
  onMessage?: (message: InkboxMessage) => boolean | Promise<boolean>;
}

export class InkboxAdapter implements Adapter<InkboxRoute, InkboxMessage> {
  readonly name = "inkbox";
  get userName(): string {
    return this.options.agentHandle;
  }
  readonly transport: InkboxTransport;
  private chat?: ChatInstance;
  private identityId?: string;
  get botUserId() {
    return this.identityId;
  }

  constructor(private readonly options: InkboxAdapterOptions) {
    if (!options.agentHandle)
      throw new Error("An Inkbox agent handle is required");
    this.transport = new InkboxTransport(options);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.identityId = (await this.transport.identity()).id;
  }
  getConcurrencyScope(): string {
    return `inkbox:${this.options.agentHandle}`;
  }

  encodeThreadId(route: InkboxRoute): string {
    const base = { identityId: route.identityId, channel: route.channel };
    let stable: object;
    switch (route.channel) {
      case "email":
        stable = {
          ...base,
          emailAddress: route.emailAddress,
          threadId: route.threadId,
        };
        break;
      case "sms":
        stable = { ...base, conversationId: route.conversationId };
        break;
      case "imessage":
        stable = {
          ...base,
          conversationId: route.conversationId,
          threadId: route.threadId,
          replyToMessageId: route.replyToMessageId,
          isGroup: route.isGroup === true,
        };
        break;
      case "slack":
        stable = {
          ...base,
          connectionId: route.connectionId,
          conversationId: route.conversationId,
          threadTs: route.threadTs,
        };
        break;
      case "a2a":
        stable = { ...base, taskId: route.taskId };
        break;
      case "voice":
        stable = { ...base, callId: route.callId };
        break;
    }
    return `inkbox:${Buffer.from(JSON.stringify(stable)).toString("base64url")}`;
  }

  decodeThreadId(threadId: string): InkboxRoute {
    if (!/^inkbox:[A-Za-z0-9_-]+$/.test(threadId))
      throw new Error("Invalid Inkbox thread ID");
    const r = object(
      JSON.parse(Buffer.from(threadId.slice(7), "base64url").toString("utf8")),
    );
    const identityId = required(r.identityId, "identity id");
    if (this.identityId && identityId !== this.identityId)
      throw new Error("Thread belongs to a different Inkbox identity");
    const str = (key: string) => required(r[key], key);
    const opt = (key: string) => (r[key] === undefined ? undefined : str(key));
    switch (r.channel) {
      case "email":
        return {
          identityId,
          channel: "email",
          emailAddress: str("emailAddress"),
          threadId: str("threadId"),
        };
      case "sms":
        return {
          identityId,
          channel: "sms",
          conversationId: str("conversationId"),
        };
      case "imessage":
        return {
          identityId,
          channel: "imessage",
          conversationId: str("conversationId"),
          threadId: opt("threadId"),
          replyToMessageId: opt("replyToMessageId"),
          isGroup: r.isGroup === true,
        };
      case "slack":
        return {
          identityId,
          channel: "slack",
          connectionId: str("connectionId"),
          conversationId: str("conversationId"),
          threadTs: opt("threadTs"),
        };
      case "a2a":
        return { identityId, channel: "a2a", taskId: str("taskId") };
      case "voice":
        return { identityId, channel: "voice", callId: str("callId") };
      default:
        throw new Error("Unsupported Inkbox channel");
    }
  }

  channelIdFromThreadId(threadId: string): string {
    const route = this.decodeThreadId(threadId);
    if (route.channel === "slack")
      return this.encodeThreadId({ ...route, threadTs: undefined });
    if (route.channel === "imessage")
      return this.encodeThreadId({
        ...route,
        threadId: undefined,
        replyToMessageId: undefined,
      });
    return this.encodeThreadId(route);
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    if (request.method !== "POST")
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "POST" },
      });
    if (!this.chat)
      throw new Error(
        "Initialize the adapter with Chat before handling webhooks",
      );
    const timestamp = request.headers.get("x-inkbox-timestamp") ?? "";
    const requestId = request.headers.get("x-inkbox-request-id");
    const signature = request.headers.get("x-inkbox-signature") ?? "";
    if (
      !requestId ||
      !/^\d+$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !/^sha256=[a-f0-9]{64}$/.test(signature)
    ) {
      return new Response("Invalid webhook signature", { status: 401 });
    }
    const body = await readBody(request);
    if (body === null)
      return new Response("Webhook too large", { status: 413 });
    const secret =
      typeof this.options.signingSecret === "function"
        ? await this.options.signingSecret()
        : this.options.signingSecret;
    if (
      !secret ||
      !verifyWebhook({
        payload: body,
        headers: {
          "x-inkbox-timestamp": timestamp,
          "x-inkbox-request-id": requestId,
          "x-inkbox-signature": signature,
        },
        secret,
      })
    ) {
      return new Response("Invalid webhook signature", { status: 401 });
    }
    const identity = await this.transport.identity();
    if (identity.id !== this.identityId)
      throw new Error(
        "Configured Inkbox identity changed; initialize a new adapter",
      );
    let normalized: InkboxMessage | null;
    try {
      normalized = normalizeEvent(JSON.parse(body.toString("utf8")), identity);
    } catch {
      return new Response("Invalid webhook payload", { status: 400 });
    }
    if (!normalized) return new Response("OK");
    if (this.options.onMessage && !(await this.options.onMessage(normalized)))
      return new Response("OK");
    const task = this.dispatch(normalized, {
      ...options,
      waitUntil: undefined,
    });
    if (options?.waitUntil) options.waitUntil(task);
    else await task;
    return new Response("OK");
  }

  private async dispatch(
    normalized: InkboxMessage,
    options: WebhookOptions,
  ): Promise<void> {
    const route = normalized.route;
    // Complete mail bodies and authenticated attachment references come from the SDK.
    if (route.channel === "email") {
      const hydrated = await this.transport.getMessage(route, normalized.id);
      normalized = { ...normalized, ...this.fromTransport(route, hydrated) };
    }
    if (route.channel === "voice" && normalized.event) {
      const transcript = object(object(normalized.event.data).transcript ?? {});
      if (
        transcript.abridged === true ||
        !Array.isArray(transcript.entries) ||
        transcript.entries.some((entry) => object(entry).truncated === true)
      ) {
        const lines: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await this.transport.history(route, {
            limit: 100,
            cursor,
            direction: "forward",
          });
          lines.push(...page.messages.map((m) => `${m.authorId}: ${m.text}`));
          cursor = page.nextCursor;
        } while (cursor);
        normalized = {
          ...normalized,
          text: lines.length
            ? `Completed call transcript\n${lines.join("\n")}`
            : normalized.text,
        };
      }
    }
    const threadId = this.encodeThreadId(route);
    await this.chat!.processMessage(
      this,
      threadId,
      this.parseMessage(normalized),
      options,
    );
  }

  parseMessage(raw: InkboxMessage): Message<InkboxMessage> {
    const date = new Date(raw.createdAt);
    if (!Number.isFinite(date.getTime()))
      throw new Error("Invalid message date");
    return new Message({
      id: this.messageId(raw.route, raw.id),
      threadId: this.encodeThreadId(raw.route),
      text: raw.text,
      formatted: parseMarkdown(raw.text),
      raw,
      isMention: raw.isMention ?? false,
      author: {
        userId: raw.authorId,
        userName: raw.authorId,
        fullName: raw.authorName ?? raw.authorId,
        isMe: raw.isMe,
        isBot: raw.route.channel === "a2a" ? true : "unknown",
      },
      metadata: { dateSent: date, edited: false },
      attachments: (raw.attachments ?? []).map((a) =>
        this.rehydrateAttachment(
          a.fetchMetadata?.reference
            ? {
                ...a,
                fetchMetadata: {
                  ...a.fetchMetadata,
                  route: this.encodeThreadId(raw.route),
                },
              }
            : a,
        ),
      ),
    });
  }

  private messageId(route: InkboxRoute, id: string): string {
    return `inkbox-message:${Buffer.from(JSON.stringify([this.encodeThreadId(route), id])).toString("base64url")}`;
  }
  private nativeMessageId(threadId: string, id: string): string {
    if (!id.startsWith("inkbox-message:")) return id;
    const decoded: unknown = JSON.parse(
      Buffer.from(id.slice(15), "base64url").toString("utf8"),
    );
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      decoded[0] !== threadId ||
      typeof decoded[1] !== "string"
    )
      throw new Error("Message belongs to a different thread");
    return decoded[1];
  }

  renderFormatted(content: FormattedContent): string {
    return stringifyMarkdown(content);
  }

  private fromTransport(
    route: InkboxRoute,
    message: TransportMessage,
  ): InkboxMessage {
    return {
      ...message,
      route,
      attachments: message.attachments?.map((a) => this.attachment(route, a)),
    };
  }

  private attachment(
    route: InkboxRoute,
    attachment: TransportAttachment,
  ): Attachment {
    const kind = attachment.mimeType?.split("/")[0];
    return this.rehydrateAttachment({
      type:
        kind === "image" || kind === "video" || kind === "audio"
          ? kind
          : "file",
      url: attachment.url,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      fetchMetadata: attachment.reference
        ? {
            route: this.encodeThreadId(route),
            reference: JSON.stringify(attachment.reference),
          }
        : undefined,
    });
  }

  rehydrateAttachment(attachment: Attachment): Attachment {
    if (!attachment.fetchMetadata?.reference) return attachment;
    const { route, reference } = attachment.fetchMetadata;
    return {
      ...attachment,
      fetchData: async () => {
        const value = await this.transport.attachment(
          this.decodeThreadId(route),
          JSON.parse(reference),
        );
        return typeof value === "string"
          ? downloadAttachment(value, { adapter: this.name })
          : Buffer.from(value);
      },
    };
  }

  async postMessage(threadId: string, message: AdapterPostableMessage) {
    return this.send(threadId, message);
  }

  /** Supply a stable key when the application may retry an outbound operation. */
  async send(
    threadId: string,
    message: AdapterPostableMessage,
    options: Pick<TransportSend, "idempotencyKey" | "a2aIntent"> = {},
  ) {
    let route = this.decodeThreadId(threadId);
    if (route.channel === "email" && options.idempotencyKey) {
      if (!this.chat)
        throw new Error(
          "Initialize Chat before sending with a persistent email retry key",
        );
      const key = `inkbox:email-send:${createHash("sha256")
        .update(JSON.stringify([threadId, options.idempotencyKey]))
        .digest("hex")}`;
      const state = this.chat.getState();
      const stored = await state.get<InkboxRoute>(key);
      if (stored) route = stored;
      else {
        const prepared = await this.transport.prepareEmailReply(route);
        await state.setIfNotExists(key, prepared);
        route = (await state.get<InkboxRoute>(key)) ?? prepared;
      }
    }
    const text =
      typeof message === "string"
        ? message
        : "raw" in message
          ? message.raw
          : "markdown" in message
            ? message.markdown
            : "ast" in message
              ? this.renderFormatted(message.ast)
              : cardToFallbackText(extractCard(message)!);
    const files =
      typeof message !== "string" && "files" in message
        ? (message.files ?? [])
        : [];
    const attachments =
      typeof message !== "string" && "attachments" in message
        ? (message.attachments ?? [])
        : [];
    const input: TransportSend = {
      text,
      ...options,
      idempotencyKey: options.idempotencyKey ?? randomUUID(),
    };
    if (files.length || attachments.length) {
      if (route.channel === "email" || route.channel === "slack") {
        input.attachments = [];
        for (const file of files) {
          const bytes =
            file.data instanceof Blob
              ? Buffer.from(await file.data.arrayBuffer())
              : Buffer.from(file.data as ArrayBuffer);
          input.attachments.push({
            filename: file.filename,
            contentBase64: bytes.toString("base64"),
            contentType: file.mimeType ?? "application/octet-stream",
          });
        }
        for (const attachment of attachments) {
          const bytes = await attachmentBytes(attachment);
          input.attachments.push({
            filename: attachment.name ?? "attachment",
            contentBase64: bytes.toString("base64"),
            contentType: attachment.mimeType ?? "application/octet-stream",
          });
        }
      } else if (route.channel === "imessage") {
        if (files.length + attachments.length > 1)
          throw new Error("iMessage supports one attachment per message");
        input.mediaUrls = [];
        for (const file of files) {
          const content =
            file.data instanceof Blob
              ? file.data
              : new Uint8Array(file.data as ArrayBuffer);
          input.mediaUrls.push(
            (
              await this.transport.uploadMedia({
                content,
                filename: file.filename,
                contentType: file.mimeType,
              })
            ).mediaUrl,
          );
        }
        for (const attachment of attachments) {
          input.mediaUrls.push(
            attachment.url ??
              (
                await this.transport.uploadMedia({
                  content: await attachmentBytes(attachment),
                  filename: attachment.name ?? "attachment",
                  contentType: attachment.mimeType,
                })
              ).mediaUrl,
          );
        }
      } else if (
        route.channel === "sms" &&
        !files.length &&
        attachments.every((a) => a.url && !a.data)
      ) {
        input.mediaUrls = attachments.map((a) => a.url!);
      } else {
        throw new NotImplementedError(
          `File posting is not supported for ${route.channel}`,
        );
      }
    }
    const result = await this.supported(() =>
      this.transport.send(route, input),
    );
    const raw: InkboxMessage = {
      route,
      id: result.id,
      text,
      authorId: route.identityId,
      isMe: true,
      createdAt: new Date(),
      raw: result.raw,
    };
    return { id: this.messageId(route, result.id), threadId, raw };
  }

  async fetchMessages(threadId: string, options?: FetchOptions) {
    const route = this.decodeThreadId(threadId);
    const page = await this.transport.history(route, options);
    return {
      messages: page.messages.map((m) =>
        this.parseMessage(this.fromTransport(route, m)),
      ),
      nextCursor: page.nextCursor,
    };
  }
  async fetchMessage(threadId: string, messageId: string) {
    const route = this.decodeThreadId(threadId);
    return this.parseMessage(
      this.fromTransport(
        route,
        await this.transport.getMessage(
          route,
          this.nativeMessageId(threadId, messageId),
        ),
      ),
    );
  }
  async fetchThread(threadId: string) {
    const route = this.decodeThreadId(threadId);
    return {
      id: threadId,
      channelId: this.channelIdFromThreadId(threadId),
      metadata: { channel: route.channel },
      isDM: this.isDM(threadId),
    };
  }
  isDM(threadId: string): boolean {
    const route = this.decodeThreadId(threadId);
    return (
      (route.channel === "slack" && route.conversationId.startsWith("D")) ||
      route.channel === "a2a" ||
      route.channel === "voice" ||
      (route.channel === "imessage" && !route.isGroup)
    );
  }
  async startTyping(threadId: string) {
    await this.supported(() =>
      this.transport.typing(this.decodeThreadId(threadId)),
    );
  }
  async markAsRead(threadId: string) {
    await this.supported(() =>
      this.transport.markRead(this.decodeThreadId(threadId)),
    );
  }
  private reaction(route: InkboxRoute, emoji: EmojiValue | string): string {
    const normalized =
      typeof emoji === "string"
        ? defaultEmojiResolver.fromSlack(
            defaultEmojiResolver.fromGChat(emoji).name,
          )
        : emoji;
    if (route.channel === "slack")
      return defaultEmojiResolver.toSlack(normalized);
    const names: Record<string, string> = {
      thumbs_up: "like",
      thumbs_down: "dislike",
      heart: "love",
      laughing: "laugh",
      joy: "laugh",
      exclamation: "emphasize",
      question: "question",
      eyes: "eyes",
    };
    return names[normalized.name] ?? normalized.name;
  }
  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ) {
    await this.supported(() =>
      this.transport.addReaction(
        this.decodeThreadId(threadId),
        this.nativeMessageId(threadId, messageId),
        this.reaction(this.decodeThreadId(threadId), emoji),
      ),
    );
  }
  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ) {
    await this.supported(() =>
      this.transport.removeReaction(
        this.decodeThreadId(threadId),
        this.nativeMessageId(threadId, messageId),
        this.reaction(this.decodeThreadId(threadId), emoji),
      ),
    );
  }
  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ) {
    if (
      typeof message !== "string" &&
      (("files" in message && message.files?.length) ||
        ("attachments" in message && message.attachments?.length))
    )
      throw new NotImplementedError("Editing attachments is not supported");
    const route = this.decodeThreadId(threadId);
    const text =
      typeof message === "string"
        ? message
        : "raw" in message
          ? message.raw
          : "markdown" in message
            ? message.markdown
            : "ast" in message
              ? this.renderFormatted(message.ast)
              : cardToFallbackText(extractCard(message)!);
    const result = await this.supported(() =>
      this.transport.editMessage(
        route,
        this.nativeMessageId(threadId, messageId),
        text,
      ),
    );
    const raw: InkboxMessage = {
      route,
      id: result.id,
      text,
      authorId: route.identityId,
      isMe: true,
      createdAt: new Date(),
      raw: result.raw,
    };
    return { id: this.messageId(route, result.id), threadId, raw };
  }
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    await this.supported(() =>
      this.transport.deleteMessage(
        this.decodeThreadId(threadId),
        this.nativeMessageId(threadId, messageId),
      ),
    );
  }
  private async supported<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof UnsupportedChannelOperationError)
        throw new NotImplementedError(error.message);
      throw error;
    }
  }
}

async function attachmentBytes(attachment: Attachment): Promise<Buffer> {
  if (attachment.data instanceof Blob)
    return Buffer.from(await attachment.data.arrayBuffer());
  if (attachment.data) return Buffer.from(attachment.data);
  if (attachment.fetchData) {
    const data = await attachment.fetchData();
    return data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data);
  }
  if (attachment.url)
    return downloadAttachment(attachment.url, { adapter: "inkbox" });
  throw new Error("Attachment has no content");
}
async function readBody(request: Request): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 10 * 1024 * 1024) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function createInkboxAdapter(
  options: InkboxAdapterOptions,
): InkboxAdapter {
  return new InkboxAdapter(options);
}
