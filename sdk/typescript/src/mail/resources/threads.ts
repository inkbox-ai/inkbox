/**
 * inkbox-mail/resources/threads.ts
 *
 * Thread operations: list (auto-paginated), get with messages, delete.
 */

import { HttpTransport } from "../../_http.js";
import {
  RawCursorPage,
  RawThread,
  Thread,
  ThreadDetail,
  parseThread,
  parseThreadDetail,
} from "../types.js";

const DEFAULT_PAGE_SIZE = 50;

export class ThreadsResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Async iterator over all threads in a mailbox, most recent activity first.
   *
   * Pagination is handled automatically — just iterate.
   *
   * @example
   * ```ts
   * for await (const thread of client.threads.list(emailAddress)) {
   *   console.log(thread.subject, thread.messageCount);
   * }
   * ```
   */
  async *list(
    emailAddress: string,
    options?: { pageSize?: number },
  ): AsyncGenerator<Thread> {
    const limit = options?.pageSize ?? DEFAULT_PAGE_SIZE;
    let cursor: string | undefined;

    while (true) {
      const page = await this.http.get<RawCursorPage<RawThread>>(
        `/mailboxes/${emailAddress}/threads`,
        { limit, cursor },
      );
      for (const item of page.items) {
        yield parseThread(item);
      }
      if (!page.has_more) break;
      cursor = page.next_cursor ?? undefined;
    }
  }

  /**
   * Get a thread with all its messages inlined.
   *
   * @param emailAddress - Full email address of the owning mailbox.
   * @param threadId - UUID of the thread.
   */
  async get(emailAddress: string, threadId: string): Promise<ThreadDetail> {
    const data = await this.http.get<RawThread>(
      `/mailboxes/${emailAddress}/threads/${threadId}`,
    );
    return parseThreadDetail(data);
  }

  /** Delete a thread. */
  async delete(emailAddress: string, threadId: string): Promise<void> {
    await this.http.delete(`/mailboxes/${emailAddress}/threads/${threadId}`);
  }
}
