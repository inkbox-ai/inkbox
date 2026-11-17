import { describe, expect, it } from "vitest";
import { normalizeEvent } from "../src/events.js";

const identity = { id: "identity-test", emailAddress: "assistant@example.com" };
const event = (event_type: string, data: unknown) => ({
  id: "evt-test",
  event_type,
  timestamp: "2026-01-01T00:00:00Z",
  data,
});

describe("channel message content", () => {
  it("preserves current A2A text and structured data parts without kind discriminators", () => {
    const message = normalizeEvent(
      event("a2a.task.created", {
        task_id: "task-test",
        message_id: "message-test",
        caller: { identity_id: "caller-test" },
        parts: [{ text: "Please prioritize" }, { data: { priority: 1 } }],
      }),
      identity,
    );
    expect(message?.text).toBe('Please prioritize\n{"priority":1}');
    expect(message?.authorId).toBe("caller-test");
  });

  it("preserves authenticated Slack file references without download credentials", () => {
    const message = normalizeEvent(
      event("slack.dm_received", {
        identity_id: identity.id,
        connection_id: "connection-test",
        conversation_id: "conversation-test",
        message_ts: "123.456",
        actor_id: "user-test",
        event: {
          text: "",
          files: [
            {
              id: "file-test",
              name: "image.png",
              mimetype: "image/png",
              size: 12,
            },
          ],
        },
      }),
      identity,
    );
    expect(message?.attachments).toEqual([
      {
        type: "image",
        name: "image.png",
        mimeType: "image/png",
        size: 12,
        fetchMetadata: {
          reference: JSON.stringify({
            channel: "slack",
            connectionId: "connection-test",
            fileId: "file-test",
          }),
        },
      },
    ]);
  });

  it("marks omitted and truncated transcript content instead of inventing empty turns", () => {
    const message = normalizeEvent(
      event("call.ended", {
        call: {
          id: "call-test",
          direction: "inbound",
          status: "completed",
          remote_phone_number: "+12025550123",
        },
        transcript: {
          abridged: true,
          entries: [
            { party: "remote", text: "Hello" },
            { marker: "abridged", omitted_turns: 4 },
            { party: "local", text: "A partial answer", truncated: true },
          ],
        },
      }),
      identity,
    );
    expect(message?.text).toContain("[Transcript abridged: 4 turns omitted]");
    expect(message?.text).toContain("local: A partial answer [turn truncated]");
    expect(message?.text).not.toContain("speaker:");
  });
});
