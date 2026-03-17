import { describe, it, expect, vi } from "vitest";
import { AgentIdentity } from "../../src/agent_identity.js";
import { parseAgentIdentityData } from "../../src/identities/types.js";
import { parseMessageDetail, parseThreadDetail } from "../../src/mail/types.js";
import type { Inkbox } from "../../src/inkbox.js";
import { InkboxAPIError } from "../../src/_http.js";
import { RAW_IDENTITY_DETAIL, RAW_MESSAGE_DETAIL, RAW_THREAD_DETAIL } from "../sampleData.js";

const THREAD_ID = RAW_THREAD_DETAIL.id;
const MESSAGE_ID = RAW_MESSAGE_DETAIL.id;

function mockInkbox() {
  return {
    _messages: { get: vi.fn() },
    _threads: { get: vi.fn() },
  } as unknown as Inkbox;
}

function identityWithMailbox() {
  const data = parseAgentIdentityData(RAW_IDENTITY_DETAIL);
  const inkbox = mockInkbox();
  return { identity: new AgentIdentity(data, inkbox), inkbox };
}

function identityWithoutMailbox() {
  const data = parseAgentIdentityData({ ...RAW_IDENTITY_DETAIL, mailbox: null });
  const inkbox = mockInkbox();
  return { identity: new AgentIdentity(data, inkbox), inkbox };
}

describe("AgentIdentity.getMessage", () => {
  it("fetches message detail from identity mailbox", async () => {
    const { identity, inkbox } = identityWithMailbox();
    const messageDetail = parseMessageDetail(RAW_MESSAGE_DETAIL);
    vi.mocked(inkbox._messages.get).mockResolvedValue(messageDetail);

    const result = await identity.getMessage(MESSAGE_ID);

    expect(inkbox._messages.get).toHaveBeenCalledWith("sales-agent@inkbox.ai", MESSAGE_ID);
    expect(result.id).toBe(MESSAGE_ID);
    expect(result.bodyText).toBe("Hi there, this is a test message body.");
  });

  it("throws when no mailbox is assigned", async () => {
    const { identity } = identityWithoutMailbox();

    await expect(identity.getMessage(MESSAGE_ID)).rejects.toThrow(InkboxAPIError);
  });
});

describe("AgentIdentity.getThread", () => {
  it("fetches thread detail from identity mailbox", async () => {
    const { identity, inkbox } = identityWithMailbox();
    const threadDetail = parseThreadDetail(RAW_THREAD_DETAIL);
    vi.mocked(inkbox._threads.get).mockResolvedValue(threadDetail);

    const result = await identity.getThread(THREAD_ID);

    expect(inkbox._threads.get).toHaveBeenCalledWith("sales-agent@inkbox.ai", THREAD_ID);
    expect(result.id).toBe(THREAD_ID);
    expect(result.messages).toHaveLength(1);
  });

  it("throws when no mailbox is assigned", async () => {
    const { identity } = identityWithoutMailbox();

    await expect(identity.getThread(THREAD_ID)).rejects.toThrow(InkboxAPIError);
  });
});
