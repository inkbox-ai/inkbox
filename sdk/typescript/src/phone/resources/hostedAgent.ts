/**
 * inkbox-phone/resources/hostedAgent.ts
 *
 * Identity-scoped Inkbox Voice AI config (getConfig / setConfig).
 */

import { HttpTransport } from "../../_http.js";
import {
  HostedAgentConfig,
  RawHostedAgentConfig,
  parseHostedAgentConfig,
} from "../types.js";

export class HostedAgentConfigResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Get the Inkbox Voice AI config.
   *
   * Agent-scoped keys resolve their own identity; admin/JWT callers must
   * pass `agentIdentityId` (the server returns 422 otherwise).
   *
   * @param options.agentIdentityId - UUID of the agent identity. Optional
   *   for agent-scoped keys; required under admin/JWT.
   */
  async getConfig(options?: {
    agentIdentityId?: string;
  }): Promise<HostedAgentConfig> {
    const params: Record<string, string> = {};
    if (options?.agentIdentityId !== undefined) {
      params["agent_identity_id"] = options.agentIdentityId;
    }
    const data = await this.http.get<RawHostedAgentConfig>(
      "/hosted-agent-config",
      params,
    );
    return parseHostedAgentConfig(data);
  }

  /**
   * Set the Inkbox Voice AI config.
   *
   * Full-replace PUT: every call sets all three fields, and a field left
   * undefined resets to the server default — there is no partial update.
   *
   * @param options.voice - Voice override; omit for the server default.
   * @param options.model - Model override; omit for the server default.
   * @param options.instructions - Per-identity steering prompt appended to
   *   Voice AI's system prompt; omit for none.
   * @param options.agentIdentityId - UUID of the agent identity. Optional
   *   for agent-scoped keys; required under admin/JWT.
   */
  async setConfig(options?: {
    voice?: string;
    model?: string;
    instructions?: string;
    agentIdentityId?: string;
  }): Promise<HostedAgentConfig> {
    const body: Record<string, unknown> = {};
    if (options?.agentIdentityId !== undefined) {
      body["agent_identity_id"] = options.agentIdentityId;
    }
    // Omitted fields are equivalent to explicit nulls on this full-replace
    // PUT: the server resets them to its defaults.
    if (options?.voice !== undefined) body["voice"] = options.voice;
    if (options?.model !== undefined) body["model"] = options.model;
    if (options?.instructions !== undefined) {
      body["instructions"] = options.instructions;
    }
    const data = await this.http.put<RawHostedAgentConfig>(
      "/hosted-agent-config",
      body,
    );
    return parseHostedAgentConfig(data);
  }
}
