// sdk/typescript/tests/filterMode.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport } from "../src/_http.js";
import { MailboxesResource } from "../src/mail/resources/mailboxes.js";
import { ThreadsResource } from "../src/mail/resources/threads.js";
import {
  FilterMode,
  ThreadFolder,
  parseMailbox,
} from "../src/mail/types.js";

const BASE = "https://inkbox.ai/api/v1";

const MAILBOX_DICT = {
  id: "aaaa1111-0000-0000-0000-000000000001",
  email_address: "box@inkbox.ai",
  display_name: "Agent",
  webhook_url: null,
  created_at: "2026-04-20T00:00:00Z",
  updated_at: "2026-04-20T00:00:00Z",
};

const THREAD_DICT = {
  id: "eeee5555-0000-0000-0000-000000000001",
  mailbox_id: "aaaa1111-0000-0000-0000-000000000001",
  subject: "Hello",
  message_count: 1,
  last_message_at: "2026-04-20T00:00:00Z",
  created_at: "2026-04-20T00:00:00Z",
};

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get() { return null; },
      getSetCookie() { return []; },
    } as unknown as Headers,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("Mailbox filterMode", () => {
  it("parseMailbox defaults filterMode to blacklist", () => {
    const mb = parseMailbox(MAILBOX_DICT as unknown as any);
    expect(mb.filterMode).toBe(FilterMode.BLACKLIST);
    expect(mb.filterModeChangeNotice).toBeNull();
  });

  it("parseMailbox parses change notice when present", () => {
    const mb = parseMailbox({
      ...MAILBOX_DICT,
      filter_mode: "whitelist",
      filter_mode_change_notice: {
        new_filter_mode: "whitelist",
        redundant_rule_action: "block",
        redundant_rule_count: 2,
      },
    } as unknown as any);
    expect(mb.filterMode).toBe(FilterMode.WHITELIST);
    expect(mb.filterModeChangeNotice?.newFilterMode).toBe(FilterMode.WHITELIST);
    expect(mb.filterModeChangeNotice?.redundantRuleAction).toBe("block");
    expect(mb.filterModeChangeNotice?.redundantRuleCount).toBe(2);
  });
});

describe("MailboxesResource.update filter_mode wiring", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("threads filterMode through to body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeOkResponse({ ...MAILBOX_DICT, filter_mode: "whitelist" }),
    );
    const http = new HttpTransport("k", BASE);
    const resource = new MailboxesResource(http);

    await resource.update("box@inkbox.ai", { filterMode: FilterMode.WHITELIST });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body.filter_mode).toBe("whitelist");
  });

  it("omits filter_mode when not supplied", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse(MAILBOX_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new MailboxesResource(http);

    await resource.update("box@inkbox.ai", { displayName: "New" });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect("filter_mode" in body).toBe(false);
  });
});

describe("ThreadsResource new methods", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list(folder) threads param through", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeOkResponse({ items: [], next_cursor: null, has_more: false }),
    );
    const http = new HttpTransport("k", BASE);
    const resource = new ThreadsResource(http);

    const iterator = resource.list("box@inkbox.ai", { folder: ThreadFolder.BLOCKED });
    for await (const _ of iterator) {
      // drain
    }

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("folder=blocked");
  });

  it("listFolders returns an array of ThreadFolder values", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeOkResponse(["inbox", "spam", "blocked"]),
    );
    const http = new HttpTransport("k", BASE);
    const resource = new ThreadsResource(http);

    const folders = await resource.listFolders("box@inkbox.ai");

    expect(folders).toEqual([
      ThreadFolder.INBOX,
      ThreadFolder.SPAM,
      ThreadFolder.BLOCKED,
    ]);
  });

  it("update(folder=BLOCKED) rejects client-side without HTTP", async () => {
    const http = new HttpTransport("k", BASE);
    const resource = new ThreadsResource(http);

    await expect(
      resource.update("box@inkbox.ai", "eeee5555-0000-0000-0000-000000000001", {
        folder: ThreadFolder.BLOCKED,
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("update returns bare Thread (no messages) and sends folder", async () => {
    // Server returns ThreadResponse on PATCH (no `messages` field). The SDK
    // must parse this as Thread, not ThreadDetail — otherwise every update
    // falsely reports the thread's messages wiped out.
    vi.mocked(fetch).mockResolvedValue(
      makeOkResponse({ ...THREAD_DICT, folder: "archive" }),
    );
    const http = new HttpTransport("k", BASE);
    const resource = new ThreadsResource(http);

    const result = await resource.update(
      "box@inkbox.ai",
      "eeee5555-0000-0000-0000-000000000001",
      { folder: ThreadFolder.ARCHIVE },
    );

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body).toEqual({ folder: "archive" });
    expect(result.folder).toBe(ThreadFolder.ARCHIVE);
    // Parsed as Thread, so no `messages` field on the returned object
    expect((result as unknown as { messages?: unknown }).messages).toBeUndefined();
  });
});
