export type HostingHarness = "codex" | "hermes" | "claude_code" | "opencode" | "deepseek" | "openclaw";
export type HostingModel = "gpt-6-luna" | "gpt-6.1-terra" | "gpt-6.1-sol" | "gpt-6-astra" | "claude-haiku-5-5" | "claude-sonnet-5-5" | "claude-opus-5-5" | "claude-fable-5-2" | "deepseek-flash" | "deepseek-v4-pro";

/** Generation-checked partial command: omitted settings stay unchanged.
 * enabled defaults to true (activate/retry); false removes hosting.
 * Null only clears credentialBindingId. Empty triggerEvents disables triggers;
 * followDefaults/resetInstructions restore the respective defaults.
 */
export interface HostingUpdate {
  expectedGeneration: number;
  enabled?: boolean;
  harness?: HostingHarness;
  /** Default for turns and scheduled work that do not override the model. */
  defaultModel?: HostingModel;
  tier?: "medium";
  /** Initial allocation; resize existing computers through the workspace. */
  shapeId?: string;
  instructions?: string;
  triggerEvents?: string[];
  followDefaults?: boolean;
  credentialBindingId?: string | null;
  /** Inactivity timeout; new agents default to 60 seconds. */
  idleTimeoutSeconds?: 60 | 300;
  /** Automatic idle shutdown is required. */
  idleStopEnabled?: true;
  resetInstructions?: boolean;
}

export interface HostingConfiguration {
  mode: "external" | "inkbox";
  identityId: string;
  machineId: string | null;
  harness: string | null;
  defaultModel: HostingModel;
  tier: string | null;
  shapeId: string | null;
  state: string;
  generation: number;
  appliedGeneration: number;
  instructions: string;
  triggerEvents: string[];
  followDefaults: boolean;
  credentialBindingId: string | null;
  idleTimeoutSeconds: number;
  idleStopEnabled: boolean;
  lastError: string | null;
  updatedAt: string | null;
}

interface RawHostingConfiguration {
  mode: HostingConfiguration["mode"];
  identity_id: string;
  machine_id?: string | null;
  harness?: string | null;
  default_model?: HostingModel;
  tier?: string | null;
  shape_id?: string | null;
  state: string;
  generation: number;
  applied_generation: number;
  instructions?: string;
  trigger_events?: string[];
  follow_defaults?: boolean;
  credential_binding_id?: string | null;
  idle_timeout_seconds?: number;
  idle_stop_enabled?: boolean;
  last_error?: string | null;
  updated_at?: string | null;
}

export function parseHosting(data: RawHostingConfiguration): HostingConfiguration {
  return {
    mode: data.mode, identityId: data.identity_id, machineId: data.machine_id ?? null,
    harness: data.harness ?? null, tier: data.tier ?? null, state: data.state,
    shapeId: data.shape_id ?? null,
    defaultModel: data.default_model ?? "gpt-6.1-terra",
    generation: data.generation, appliedGeneration: data.applied_generation,
    instructions: data.instructions ?? "", triggerEvents: data.trigger_events ?? [],
    followDefaults: data.follow_defaults ?? true, credentialBindingId: data.credential_binding_id ?? null,
    idleStopEnabled: data.idle_stop_enabled ?? true, idleTimeoutSeconds: data.idle_timeout_seconds ?? 60, lastError: data.last_error ?? null,
    updatedAt: data.updated_at ?? null,
  };
}

export function hostingUpdateBody(options: HostingUpdate): Record<string, unknown> {
  return {
    idle_stop_enabled: options.idleStopEnabled, reset_instructions: options.resetInstructions,
    expected_generation: options.expectedGeneration, enabled: options.enabled,
    harness: options.harness, tier: options.tier, instructions: options.instructions,
    shape_id: options.shapeId,
    default_model: options.defaultModel,
    trigger_events: options.triggerEvents, follow_defaults: options.followDefaults,
    credential_binding_id: options.credentialBindingId, idle_timeout_seconds: options.idleTimeoutSeconds,
  };
}


export interface HostingDelivery {
  id: string;
  event: string;
  state: "pending" | "delivering" | "accepted" | "expired" | "cancelled";
  attempts: number;
  receivedAt: string;
  lastError: string | null;
  retryable: boolean;
}

export function parseHostingDelivery(data: {
  id: string; event: string; state: HostingDelivery["state"]; attempts: number;
  received_at: string; last_error: string | null; retryable: boolean;
}): HostingDelivery {
  return {id: data.id, event: data.event, state: data.state, attempts: data.attempts,
    receivedAt: data.received_at, lastError: data.last_error, retryable: data.retryable};
}
