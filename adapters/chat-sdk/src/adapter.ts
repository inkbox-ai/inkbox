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
  type StreamChunk,
  type StreamOptions,
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
  /** Default intent for explicitly task-bound A2A replies. */
  defaultA2AIntent?: TransportSend["a2aIntent"];
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
        stable = { ...base, contextId: route.contextId };
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
        return { identityId, channel: "a2a", contextId: str("contextId") };
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
    if (this.identityId && identity.id !== this.identityId)
      throw new Error(
        "Configured Inkbox identity changed; initialize a new adapter",
      );
    this.identityId = identity.id;
    let normalized: InkboxMessage | null;
    try {
      normalized = normalizeEvent(JSON.parse(body.toString("utf8")), identity);
    } catch {
      return new Response("Invalid webhook payload", { status: 400 });
    }
    if (!normalized) return new Response("OK");
    normalized = await this.hydrate(normalized);
    if (this.options.onMessage && !(await this.options.onMessage(normalized)))
      return new Response("OK");
    const threadId = this.encodeThreadId(normalized.route);
    const task = this.chat.processMessage(
      this,
      threadId,
      this.parseMessage(normalized),
      { ...options, waitUntil: undefined },
    );
    const tracked = task.catch(() => {
      this.chat!.getLogger("inkbox").error(
        "Incoming message processing failed",
        { threadId },
      );
    });
    if (options?.waitUntil)
      options.waitUntil(options.propagateHandlerErrors ? task : tracked);
    else await task;
    return new Response("OK");
  }

  private async hydrate(normalized: InkboxMessage): Promise<InkboxMessage> {
    const route = normalized.route;
    // Complete mail bodies and authenticated attachment references come from the SDK.
    if (route.channel === "email") {
      const hydrated = await this.transport.getMessage(route, normalized.id);
      normalized = { ...normalized, ...this.fromTransport(route, hydrated) };
    }
    if (route.channel === "voice" && normalized.event) {
      const data = object(normalized.event.data);
      const transcript = object(data.transcript ?? {});
      let hasTranscript =
        Array.isArray(transcript.entries) &&
        transcript.entries.some(
          (entry) =>
            typeof object(entry).text === "string" &&
            String(object(entry).text).trim().length > 0,
        );
      if (
        transcript.abridged === true ||
        !Array.isArray(transcript.entries) ||
        transcript.entries.some((entry) => object(entry).truncated === true)
      ) {
        const lines: string[] = [];
        hasTranscript = false;
        let cursor: string | undefined;
        do {
          const page = await this.transport.history(route, {
            limit: 100,
            cursor,
            direction: "forward",
          });
          hasTranscript ||= page.messages.some(
            (message) => message.text.trim().length > 0,
          );
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
      if (hasTranscript) {
        const destination = await this.transport.callConversation(
          route,
          object(data.call),
        );
        if (destination)
          normalized = {
            ...normalized,
            route: destination,
            id: `call:${route.callId}`,
            text: `Post-call transcript. Any reply will be sent by ${destination.channel === "sms" ? "SMS" : "iMessage"} in this conversation, not spoken on the call.\n${normalized.text}`,
          };
      }
    }
    return normalized;
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
      raw: sanitizeMessageRaw(raw),
      isMention: raw.isMention ?? false,
      author: {
        userId: raw.authorId,
        userName: raw.authorId,
        fullName: raw.authorName ?? raw.authorId,
        isMe: raw.isMe,
        isBot: raw.isBot ?? (raw.route.channel === "a2a" ? true : "unknown"),
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
      route:
        route.channel === "a2a"
          ? { ...route, taskId: message.a2aTaskId }
          : route,
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

  /** Consume a stream completely before sending on transports without editable messages. */
  async stream(
    threadId: string,
    chunks: AsyncIterable<string | StreamChunk>,
    options?: StreamOptions,
  ) {
    let text = "";
    for await (const chunk of chunks) {
      options?.signal?.throwIfAborted();
      if (typeof chunk === "string") text += chunk;
      else if (chunk.type === "markdown_text") text += chunk.text;
    }
    options?.signal?.throwIfAborted();
    return this.postMessage(threadId, { markdown: text });
  }

  /** Supply a stable key when the application may retry an outbound operation. */
  async send(
    threadId: string,
    message: AdapterPostableMessage,
    options: Pick<TransportSend, "idempotencyKey" | "a2aIntent"> & {
      replyToMessageId?: string;
      a2aTaskId?: string;
    } = {},
  ) {
    let route = this.decodeThreadId(threadId);
    if (route.channel === "a2a") {
      if (!options.a2aTaskId)
        throw new Error(
          "A2A replies require the originating a2aTaskId; a context does not identify a reply task",
        );
      route = { ...route, taskId: options.a2aTaskId };
    }
    if (route.channel === "email" && options.replyToMessageId)
      route = {
        ...route,
        anchorMessageId: this.nativeMessageId(
          threadId,
          options.replyToMessageId,
        ),
      };
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
              : "fallbackText" in message &&
                  typeof message.fallbackText === "string" &&
                  message.fallbackText.length > 0
                ? message.fallbackText
                : cardToFallbackText(extractCard(message)!);
    const files =
      typeof message !== "string" && "files" in message
        ? (message.files ?? []).map((file) => ({ ...file }))
        : [];
    const attachments =
      typeof message !== "string" && "attachments" in message
        ? (message.attachments ?? []).map((attachment) => ({ ...attachment }))
        : [];
    const prepare = async (): Promise<TransportSend> => {
      const input: TransportSend = {
        text,
        a2aIntent: options.a2aIntent ?? this.options.defaultA2AIntent,
        idempotencyKey: options.idempotencyKey
          ? createHash("sha256").update(options.idempotencyKey).digest("hex")
          : randomUUID(),
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
          attachments.every(
            (a) => (a.url || a.fetchMetadata?.reference) && !a.data,
          )
        ) {
          input.mediaUrls = [];
          for (const attachment of attachments) {
            if (attachment.url) {
              input.mediaUrls.push(attachment.url);
              continue;
            }
            const metadata = attachment.fetchMetadata!;
            const url = await this.transport.attachment(
              this.decodeThreadId(metadata.route),
              JSON.parse(metadata.reference),
            );
            if (typeof url !== "string")
              throw new NotImplementedError(
                "SMS forwarding requires a downloadable media URL",
              );
            input.mediaUrls.push(url);
          }
        } else {
          throw new NotImplementedError(
            `File posting is not supported for ${route.channel}`,
          );
        }
      }
      return input;
    };
    const input =
      options.idempotencyKey &&
      (files.length > 0 || attachments.length > 0) &&
      (route.channel === "sms" || route.channel === "imessage")
        ? await this.preparePhoneSend(
            threadId,
            options.idempotencyKey,
            text,
            files,
            attachments,
            prepare,
          )
        : await prepare();
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
    return {
      id: this.messageId(route, result.id),
      threadId,
      raw: sanitizeMessageRaw(raw),
    };
  }

  private async preparePhoneSend(
    threadId: string,
    operationKey: string,
    text: string,
    files: Array<{
      data: Blob | ArrayBuffer | Buffer;
      filename: string;
      mimeType?: string;
    }>,
    attachments: Attachment[],
    prepare: () => Promise<TransportSend>,
  ): Promise<TransportSend> {
    if (!this.chat)
      throw new Error(
        "Initialize Chat before sending with a persistent phone retry key",
      );
    const digest = (value: string | Uint8Array) =>
      createHash("sha256").update(value).digest("hex");
    const fileInputs = [];
    for (const file of files) {
      const bytes =
        file.data instanceof Blob
          ? Buffer.from(await file.data.arrayBuffer())
          : Buffer.isBuffer(file.data)
            ? Buffer.from(file.data)
            : Buffer.from(file.data);
      file.data = bytes;
      fileInputs.push([file.filename, file.mimeType ?? null, digest(bytes)]);
    }
    const attachmentInputs = [];
    for (const attachment of attachments) {
      let source: unknown;
      if (attachment.url) source = ["url", attachment.url];
      else if (attachment.data) {
        const bytes = await attachmentBytes(attachment);
        attachment.data = bytes;
        source = ["bytes", digest(bytes)];
      } else if (attachment.fetchMetadata?.reference)
        source = [
          "reference",
          attachment.fetchMetadata.route,
          attachment.fetchMetadata.reference,
        ];
      else {
        // Snapshot callback-only content once for both fingerprinting and upload.
        const bytes = await attachmentBytes(attachment);
        attachment.data = bytes;
        source = ["bytes", digest(bytes)];
      }
      attachmentInputs.push([
        attachment.name ?? null,
        attachment.mimeType ?? null,
        source,
      ]);
    }
    const fingerprint = digest(
      JSON.stringify([text, fileInputs, attachmentInputs]),
    );
    const key = `inkbox:phone-send:${digest(JSON.stringify([threadId, operationKey]))}`;
    const state = this.chat.getState();
    type Prepared = { fingerprint: string; input: TransportSend };
    const validate = (record: Prepared) => {
      if (record.fingerprint !== fingerprint)
        throw new Error(
          "Idempotency key already used with different message content",
        );
      return record.input;
    };
    const existing = await state.get<Prepared>(key);
    if (existing) return validate(existing);
    const reservationKey = `${key}:fingerprint`;
    await state.setIfNotExists(
      reservationKey,
      fingerprint,
      7 * 24 * 60 * 60 * 1000,
    );
    const reserved = await state.get<string>(reservationKey);
    if (!reserved)
      throw new Error(
        "Message input reservation was not retained; no upload started",
      );
    if (reserved !== fingerprint)
      throw new Error(
        "Idempotency key already used with different message content",
      );
    const lock = await state.acquireLock(key, 60_000);
    if (!lock)
      throw new Error(
        "Message preparation is in progress; retry with the same idempotency key",
      );
    try {
      const current = await state.get<Prepared>(key);
      if (current) return validate(current);
      const prepared = { fingerprint, input: await prepare() };
      // An expired lease can admit another worker. Only the immutable winner is sent.
      await state.setIfNotExists(key, prepared, 7 * 24 * 60 * 60 * 1000);
      const winner = await state.get<Prepared>(key);
      if (!winner)
        throw new Error("Prepared message was not retained; no message sent");
      return validate(winner);
    } finally {
      await state.releaseLock(lock);
    }
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
              : "fallbackText" in message &&
                  typeof message.fallbackText === "string" &&
                  message.fallbackText.length > 0
                ? message.fallbackText
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
    return {
      id: this.messageId(route, result.id),
      threadId,
      raw: sanitizeMessageRaw(raw),
    };
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

function sanitizeMessageRaw(raw: InkboxMessage): InkboxMessage {
  // Message.raw is serialized too; refreshable media URLs must not be retained there.
  function clean(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== "object" || value instanceof Date)
      return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record)
        .filter(
          ([key, item]) =>
            key !== "fetchData" &&
            !(
              key === "url" &&
              (raw.route.channel === "sms" || raw.route.channel === "imessage")
            ),
        )
        .map(([key, item]) => [key, clean(item)]),
    );
  }
  return clean(raw) as InkboxMessage;
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
