/** Machine-actionable guidance optionally included with API errors. */
export interface SupportConversationRequirements {
  authentication: string;
  claimedIdentity: boolean;
  a2aEnabled: boolean;
  supportContactAllowed: boolean;
}

export interface AgentErrorSupport {
  message: string;
  agentCardUrl: string;
  agentCardAuthenticationRequired: boolean;
  conversationRequirements: SupportConversationRequirements;
}

export interface AgentErrorGuidance {
  reason: string;
  nextSteps: readonly string[];
  support: AgentErrorSupport;
}

/** @internal Malformed guidance is ignored without hiding the API error. */
export function parseAgentErrorGuidance(value: unknown): AgentErrorGuidance | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const support = raw["support"];
  if (typeof support !== "object" || support === null || Array.isArray(support)) return null;
  const supportRaw = support as Record<string, unknown>;
  const requirements = supportRaw["conversation_requirements"];
  if (typeof requirements !== "object" || requirements === null || Array.isArray(requirements)) return null;
  const req = requirements as Record<string, unknown>;
  const steps = raw["next_steps"];
  if (
    typeof raw["reason"] !== "string" || !raw["reason"]
    || !Array.isArray(steps) || !steps.every((step) => typeof step === "string" && step.length > 0)
    || typeof supportRaw["message"] !== "string" || !supportRaw["message"]
    || typeof supportRaw["agent_card_url"] !== "string"
    || !supportRaw["agent_card_url"].startsWith("https://")
    || typeof supportRaw["agent_card_authentication_required"] !== "boolean"
    || typeof req["authentication"] !== "string" || !req["authentication"]
    || typeof req["claimed_identity"] !== "boolean"
    || typeof req["a2a_enabled"] !== "boolean"
    || typeof req["support_contact_allowed"] !== "boolean"
  ) return null;
  return {
    reason: raw["reason"],
    nextSteps: steps,
    support: {
      message: supportRaw["message"],
      agentCardUrl: supportRaw["agent_card_url"],
      agentCardAuthenticationRequired: supportRaw["agent_card_authentication_required"],
      conversationRequirements: {
        authentication: req["authentication"],
        claimedIdentity: req["claimed_identity"],
        a2aEnabled: req["a2a_enabled"],
        supportContactAllowed: req["support_contact_allowed"],
      },
    },
  };
}
