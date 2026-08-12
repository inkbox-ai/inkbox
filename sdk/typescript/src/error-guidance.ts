/** Support Agent discovery optionally included with API errors. */
export interface SupportConversationRequirements {
  authentication: string;
  claimedIdentity: boolean;
  a2aEnabled: boolean;
  supportContactAllowed: boolean;
}

export interface A2ASettingsVerification {
  method: string;
  urlTemplate: string;
  requiredValues: Readonly<Record<string, boolean>>;
  policyFields: readonly string[];
}

export interface A2AContactRulesVerification {
  method: string;
  urlTemplate: string;
  peerHandle: string;
  relevantDirections: readonly string[];
  blockingAction: string;
}

export interface AgentSupportVerification {
  a2aSettings: A2ASettingsVerification;
  contactRules: A2AContactRulesVerification;
}

export interface AgentSupport {
  message: string;
  agentCardUrl: string;
  agentCardAuthenticationRequired: boolean;
  conversationRequirements: SupportConversationRequirements;
  verification: AgentSupportVerification;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}

/** @internal Malformed support data is ignored without hiding the API error. */
export function parseAgentSupport(value: unknown): AgentSupport | null {
  const raw = object(value);
  const requirements = object(raw?.["conversation_requirements"]);
  const verification = object(raw?.["verification"]);
  const settings = object(verification?.["a2a_settings"]);
  const rules = object(verification?.["contact_rules"]);
  const requiredValues = object(settings?.["required_values"]);
  if (
    !raw ||
    !requirements ||
    !verification ||
    !settings ||
    !rules ||
    !requiredValues
  ) {
    return null;
  }
  if (
    typeof raw["message"] !== "string" ||
    !raw["message"] ||
    typeof raw["agent_card_url"] !== "string" ||
    !raw["agent_card_url"].startsWith("https://") ||
    raw["agent_card_authentication_required"] !== false ||
    requirements["authentication"] !== "agent_scoped_api_key" ||
    requirements["claimed_identity"] !== true ||
    requirements["a2a_enabled"] !== true ||
    requirements["support_contact_allowed"] !== true ||
    settings["method"] !== "GET" ||
    typeof settings["url_template"] !== "string" ||
    requiredValues["enabled"] !== true ||
    !strings(settings["policy_fields"]) ||
    rules["method"] !== "GET" ||
    typeof rules["url_template"] !== "string" ||
    rules["peer_handle"] !== "support" ||
    !strings(rules["relevant_directions"]) ||
    rules["blocking_action"] !== "block"
  ) {
    return null;
  }
  return {
    message: raw["message"],
    agentCardUrl: raw["agent_card_url"],
    agentCardAuthenticationRequired: raw["agent_card_authentication_required"],
    conversationRequirements: {
      authentication: requirements["authentication"],
      claimedIdentity: requirements["claimed_identity"],
      a2aEnabled: requirements["a2a_enabled"],
      supportContactAllowed: requirements["support_contact_allowed"],
    },
    verification: {
      a2aSettings: {
        method: settings["method"],
        urlTemplate: settings["url_template"],
        requiredValues: requiredValues as Record<string, boolean>,
        policyFields: settings["policy_fields"],
      },
      contactRules: {
        method: rules["method"],
        urlTemplate: rules["url_template"],
        peerHandle: rules["peer_handle"],
        relevantDirections: rules["relevant_directions"],
        blockingAction: rules["blocking_action"],
      },
    },
  };
}
