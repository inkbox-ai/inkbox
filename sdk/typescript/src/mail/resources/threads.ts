/**
 * inkbox-mail/resources/threads.ts
 *
 * Thread operations: list (auto-paginated), get with messages, folder
 * listing, per-thread update, and delete.
 */

import { HttpTransport } from "../../_http.js";
import {
  RawCursorPage,
  RawThread,
  Thread,
  ThreadDetail,
  ThreadFolder,
  parseThread,
  parseThreadDetail,
} from "../types.js";

const DEFAULT_PAGE_SIZE = 50;

export class ThreadsResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Async iterator over threads in a mailbox, most recent activity first.
   *
   * Pagination is handled automatically — just iterate.
   *
   * @param options.folder - Optional folder filter. When omitted, the server
   *   returns all visible folders for the caller.
   * @param options.pageSize - Number of threads fetched per API call (1–100).
   *
   * @example
   * ```ts
   * for await (const thread of client.threads.list(emailAddress, { folder: ThreadFolder.BLOCKED })) {
   *   console.log(thread.subject, thread.folder);
   * }
   * ```
   */
  async *list(
    emailAddress: string,
    options?: { folder?: ThreadFolder; pageSize?: number },
  ): AsyncGenerator<Thread> {
    const limit = options?.pageSize ?? DEFAULT_PAGE_SIZE;
    let cursor: string | undefined;

    while (true) {
      const params: Record<string, string | number | undefined> = {
        limit,
        cursor,
      };
      if (options?.folder !== undefined) {
        params.folder = options.folder;
      }
      const page = await this.http.get<RawCursorPage<RawThread>>(
        `/mailboxes/${emailAddress}/threads`,
        params,
      );
      for (const item of page.items) {
        yield parseThread(item);
      }
      if (!page.has_more) break;
      cursor = page.next_cursor ?? undefined;
    }
  }

  /**
   * Return the distinct folders that have at least one thread in this
   * mailbox.
   *
   * @returns Sorted list of {@link ThreadFolder} values that currently hold
   *   at least one non-deleted thread.
   */
  async listFolders(emailAddress: string): Promise<ThreadFolder[]> {
    const data = await this.http.get<string[]>(
      `/mailboxes/${emailAddress}/threads/folders`,
    );
    return data.map((f) => f as ThreadFolder);
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

  /**
   * Update mutable thread fields.
   *
   * Returns a bare {@link Thread} (no inlined messages). Use {@link get} to
   * refetch the thread with messages attached.
   *
   * @param options.folder - New folder. `ThreadFolder.BLOCKED` is
   *   server-assigned and cannot be set by clients; passing it throws
   *   synchronously without making an HTTP call.
   */
  async update(
    emailAddress: string,
    threadId: string,
    options: { folder?: ThreadFolder } = {},
  ): Promise<Thread> {
    const body: Record<string, unknown> = {};
    if (options.folder !== undefined) {
      if (options.folder === ThreadFolder.BLOCKED) {
        throw new Error(
          "folder='blocked' is server-assigned and cannot be set by clients " +
            "— the server will reject this PATCH.",
        );
      }
      body["folder"] = options.folder;
    }
    const data = await this.http.patch<RawThread>(
      `/mailboxes/${emailAddress}/threads/${threadId}`,
      body,
    );
    return parseThread(data);
  }

  /** Delete a thread. */
  async delete(emailAddress: string, threadId: string): Promise<void> {
    await this.http.delete(`/mailboxes/${emailAddress}/threads/${threadId}`);
  }
}
