export interface HostingUpdate {
  expectedGeneration: number;
  enabled?: boolean;
  harness?: "codex" | "hermes";
  tier?: "small" | "medium" | "large";
  instructions?: string;
  triggerEvents?: string[];
  followDefaults?: boolean;
  credentialBindingId?: string | null;
  idleTimeoutSeconds?: number;
}

export interface HostingConfiguration {
  mode: "external" | "inkbox";
  identityId: string;
  machineId: string | null;
  harness: string | null;
  tier: string | null;
  state: string;
  generation: number;
  appliedGeneration: number;
  instructions: string;
  triggerEvents: string[];
  followDefaults: boolean;
  credentialBindingId: string | null;
  idleTimeoutSeconds: number;
  lastError: string | null;
  updatedAt: string | null;
}

interface RawHostingConfiguration {
  mode: HostingConfiguration["mode"];
  identity_id: string;
  machine_id?: string | null;
  harness?: string | null;
  tier?: string | null;
  state: string;
  generation: number;
  applied_generation: number;
  instructions?: string;
  trigger_events?: string[];
  follow_defaults?: boolean;
  credential_binding_id?: string | null;
  idle_timeout_seconds?: number;
  last_error?: string | null;
  updated_at?: string | null;
}

export function parseHosting(data: RawHostingConfiguration): HostingConfiguration {
  return {
    mode: data.mode, identityId: data.identity_id, machineId: data.machine_id ?? null,
    harness: data.harness ?? null, tier: data.tier ?? null, state: data.state,
    generation: data.generation, appliedGeneration: data.applied_generation,
    instructions: data.instructions ?? "", triggerEvents: data.trigger_events ?? [],
    followDefaults: data.follow_defaults ?? true, credentialBindingId: data.credential_binding_id ?? null,
    idleTimeoutSeconds: data.idle_timeout_seconds ?? 600, lastError: data.last_error ?? null,
    updatedAt: data.updated_at ?? null,
  };
}

export function hostingUpdateBody(options: HostingUpdate): Record<string, unknown> {
  return {
    expected_generation: options.expectedGeneration, enabled: options.enabled,
    harness: options.harness, tier: options.tier, instructions: options.instructions,
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
