import { describe, expect, it, vi } from "vitest";
import type { HttpTransport } from "../src/_http.js";
import { ThreadsResource } from "../src/mail/resources/threads.js";
import { TextsResource } from "../src/phone/resources/texts.js";
import { IMessagesResource } from "../src/imessage/resources/imessages.js";

const participants = ["guest@example.com", "+14155550123"];
const contactId = "aaaaaaaa-1111-4111-8111-111111111111";

describe("conversation selectors", () => {
  for (const selector of [{ participants }, { contactId }]) {
    for (const channel of ["email", "sms", "imessage"]) {
      it(`forwards ${Object.keys(selector)[0]} for ${channel}`, async () => {
        const get = vi.fn().mockResolvedValue(channel === "email" ? { items: [], has_more: false } : []);
        const http = { get } as unknown as HttpTransport;
        if (channel === "email") {
          for await (const _item of new ThreadsResource(http).list("agent@example.com", selector)) { /* empty page */ }
        } else if (channel === "sms") {
          await new TextsResource(http).listConversations("number-id", selector);
        } else {
          await new IMessagesResource(http).listConversations(selector);
        }
        const params = get.mock.calls[0][1];
        expect(params).toMatchObject("participants" in selector ? { participants } : { contact_id: contactId });
      });
    }
  }
  it("preserves email selectors on every page", async () => {
    const get = vi.fn().mockResolvedValueOnce({ items: [], has_more: true, next_cursor: "next" }).mockResolvedValueOnce({ items: [], has_more: false });
    for await (const _item of new ThreadsResource({ get } as unknown as HttpTransport).list("agent@example.com", { participants })) { /* empty pages */ }
    expect(get.mock.calls[1][1]).toMatchObject({ participants, cursor: "next" });
  });
  it("rejects empty or conflicting filters before any request", async () => {
    const get = vi.fn();
    const resource = new TextsResource({ get } as unknown as HttpTransport);
    await expect(resource.listConversations("number", { participants: [] })).rejects.toThrow();
    await expect(resource.listConversations("number", { participants, contactId })).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
});
