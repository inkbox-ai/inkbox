/** Advisory API metadata. Codes and levels remain open to future values. */
export interface ResponseNotice {
  code: string;
  level: string;
  message: string;
}

export interface ResponseMetadata {
  notices?: ResponseNotice[];
}

export interface APIResponse<T> extends ResponseMetadata {
  data: T extends void ? null : T;
}

export type ResponseObserver = (metadata: ResponseMetadata) => void | Promise<void>;

/** @internal */
export function parseResponseNotices(value: unknown): ResponseNotice[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const notices = value.filter((item): item is ResponseNotice =>
    item !== null && typeof item === "object"
    && typeof item.code === "string" && typeof item.level === "string" && typeof item.message === "string",
  ).map(({ code, level, message }) => ({ code, level, message }));
  return notices.length ? notices : undefined;
}

/** @internal */
export function collectResponseNotices(target: ResponseNotice[], metadata: ResponseMetadata): void {
  for (const notice of metadata.notices ?? []) {
    if (!target.some((item) => item.code === notice.code && item.level === notice.level && item.message === notice.message)) {
      target.push({ ...notice });
    }
  }
}

/** @internal Optional metadata must never change the primary response outcome. */
export async function observeResponse(
  response: Response,
  url: string,
  requestMethod: string | false,
  ...observers: (ResponseObserver | undefined)[]
): Promise<void> {
  if (!observers.some(Boolean)) return;
  let notices: ResponseNotice[] | undefined;
  let validHeader = false;
  try {
    const header = response.headers?.get("Inkbox-Notices");
    if (header !== null && header !== undefined) {
      const value: unknown = JSON.parse(header);
      notices = parseResponseNotices(value);
      validHeader = value === null || (Array.isArray(value) && (value.length === 0 || notices !== undefined));
    }
  } catch { /* Ignore malformed optional metadata. */ }
  // Only these response contracts declare a top-level metadata field.
  try {
    const path = requestMethod ? new URL(url).pathname.replace(/\/+$/, "") : "";
    const bodyMetadata = /^\/api\/v1\/identities\/[^/]+$/.test(path)
      || (requestMethod === "POST" && path === "/api/v1/identities")
      || (requestMethod === "PUT" && /^\/api\/v1\/identities\/[^/]+\/avatar$/.test(path))
      || /^\/api\/v1\/identities\/[^/]+\/contacts\/[^/]+\/(access|permissions)$/.test(path)
      || /^\/api\/v1\/identities\/[^/]+\/(contact-permissions|contact-communication-policies)$/.test(path)
      || /^\/api\/v1\/contacts\/[^/]+\/(communication-policy|communication-preview)$/.test(path)
      || /^\/api\/v1\/(mail\/mailboxes|phone\/numbers)\/[^/]+$/.test(path);
    if (!validHeader && bodyMetadata && response.ok && typeof response.clone === "function"
      && response.headers?.get("content-type")?.includes("application/json")) {
      const body = await response.clone().json();
      notices = parseResponseNotices(body?.notices);
    }
  } catch { /* Preserve primary payload parsing and errors. */ }
  await notifyResponseObservers(notices ? { notices } : {}, ...observers);
}

/** @internal */
export async function notifyResponseObservers(metadata: ResponseMetadata, ...observers: (ResponseObserver | undefined)[]): Promise<void> {
  for (const observer of observers) {
    if (!observer) continue;
    try {
      await observer(metadata.notices ? { notices: metadata.notices.map((notice) => ({ ...notice })) } : {});
    } catch { /* Observers cannot fail or retry a completed request. */ }
  }
}
