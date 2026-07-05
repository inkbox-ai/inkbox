/**
 * inkbox/phone/realtime/intervene.ts
 *
 * Builders for the intervene frames your main agent sends back on the call
 * WebSocket to steer a platform-hosted call. Each returns the exact wire
 * object (ready for `JSON.stringify` onto the socket). The socket is already
 * scoped to one call, so none of these carry a `callId`.
 */

/** Resolve a `consult.requested` with an answer for the caller. */
export function consultAnswer(
  consultId: string,
  answer: string,
  instructions?: string,
): Record<string, unknown> {
  const command: Record<string, unknown> = {
    event: "consult.answer",
    consult_id: consultId,
    answer,
  };
  if (instructions !== undefined) command["instructions"] = instructions;
  return command;
}

/** Have the voice agent speak `text` on the call now. */
export function say(text: string): Record<string, unknown> {
  return { event: "inject", mode: "say", text };
}

/** Add hidden system context to the live session without speaking. */
export function injectContext(text: string): Record<string, unknown> {
  return { event: "inject", mode: "context", text };
}

/** Approve a tool call awaiting a decision. */
export function approveTool(toolCallId: string): Record<string, unknown> {
  return { event: "tool.decision", tool_call_id: toolCallId, decision: "approve" };
}

/** Deny a tool call awaiting a decision. */
export function denyTool(toolCallId: string, reason?: string): Record<string, unknown> {
  const command: Record<string, unknown> = {
    event: "tool.decision",
    tool_call_id: toolCallId,
    decision: "deny",
  };
  if (reason !== undefined) command["reason"] = reason;
  return command;
}

/** Replace the live session instructions. */
export function updateInstructions(instructions: string): Record<string, unknown> {
  return { event: "update_instructions", instructions };
}

/** Force-end the call. */
export function hangUp(reason?: string): Record<string, unknown> {
  const command: Record<string, unknown> = { event: "hang_up" };
  if (reason !== undefined) command["reason"] = reason;
  return command;
}
