/**
 * inkbox-phone/resources/hostedRealtime.ts
 *
 * Identity-scoped platform-hosted realtime voice config (get / set).
 */

import { HttpTransport } from "../../_http.js";
import {
  HostedRealtimeConfig,
  RawHostedRealtimeConfig,
  parseHostedRealtimeConfig,
} from "../types.js";

export class HostedRealtimeResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Get the hosted realtime voice config.
   *
   * Agent-scoped keys resolve their own identity; admin/JWT callers must
   * pass `agentIdentityId` (the server returns 422 otherwise).
   *
   * @param options.agentIdentityId - UUID of the agent identity. Optional
   *   for agent-scoped keys; required under admin/JWT.
   */
  async getConfig(options?: {
    agentIdentityId?: string;
  }): Promise<HostedRealtimeConfig> {
    const params: Record<string, string> = {};
    if (options?.agentIdentityId !== undefined) {
      params["agent_identity_id"] = options.agentIdentityId;
    }
    const data = await this.http.get<RawHostedRealtimeConfig>(
      "/hosted-realtime-config",
      params,
    );
    return parseHostedRealtimeConfig(data);
  }

  /**
   * Set the hosted realtime voice config.
   *
   * @param options.enabled - Whether the platform hosts the realtime voice
   *   agent for this identity's inbound calls.
   * @param options.voice - Provider voice id; omit for the server default.
   * @param options.model - Realtime model id; omit for the server default.
   * @param options.instructions - Extra system instructions appended to the
   *   base prompt.
   * @param options.agentIdentityId - UUID of the agent identity. Optional
   *   for agent-scoped keys; required under admin/JWT.
   */
  async setConfig(options: {
    enabled: boolean;
    voice?: string;
    model?: string;
    instructions?: string;
    agentIdentityId?: string;
  }): Promise<HostedRealtimeConfig> {
    const body: Record<string, unknown> = { enabled: options.enabled };
    if (options.agentIdentityId !== undefined) {
      body["agent_identity_id"] = options.agentIdentityId;
    }
    if (options.voice !== undefined) {
      body["voice"] = options.voice;
    }
    if (options.model !== undefined) {
      body["model"] = options.model;
    }
    if (options.instructions !== undefined) {
      body["instructions"] = options.instructions;
    }
    const data = await this.http.put<RawHostedRealtimeConfig>(
      "/hosted-realtime-config",
      body,
    );
    return parseHostedRealtimeConfig(data);
  }
}
