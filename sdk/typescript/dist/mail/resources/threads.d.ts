/**
 * inkbox-mail/resources/threads.ts
 *
 * Thread operations: list (auto-paginated), get with messages, delete.
 */
import { HttpTransport } from "../../_http.js";
import { Thread, ThreadDetail } from "../types.js";
export declare class ThreadsResource {
    private readonly http;
    constructor(http: HttpTransport);
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
    list(emailAddress: string, options?: {
        pageSize?: number;
    }): AsyncGenerator<Thread>;
    /**
     * Get a thread with all its messages inlined.
     *
     * @param emailAddress - Full email address of the owning mailbox.
     * @param threadId - UUID of the thread.
     */
    get(emailAddress: string, threadId: string): Promise<ThreadDetail>;
    /** Delete a thread. */
    delete(emailAddress: string, threadId: string): Promise<void>;
}
//# sourceMappingURL=threads.d.ts.map