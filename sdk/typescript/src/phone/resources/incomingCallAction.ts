/**
 * inkbox-phone/resources/incomingCallAction.ts
 *
 * Identity-scoped incoming-call routing config (get / set).
 */

import { HttpTransport } from "../../_http.js";
import {
  IncomingCallAction,
  IncomingCallActionConfig,
  RawIncomingCallActionConfig,
  parseIncomingCallActionConfig,
} from "../types.js";

export class IncomingCallActionResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Get the incoming-call routing config.
   *
   * Agent-scoped keys resolve their own identity; admin/JWT callers must
   * pass `agentIdentityId` (the server returns 422 otherwise).
   *
   * @param options.agentIdentityId - UUID of the agent identity. Optional
   *   for agent-scoped keys; required under admin/JWT.
   */
  async get(options?: {
    agentIdentityId?: string;
  }): Promise<IncomingCallActionConfig> {
    const params: Record<string, string> = {};
    if (options?.agentIdentityId !== undefined) {
      params["agent_identity_id"] = options.agentIdentityId;
    }
    const data = await this.http.get<RawIncomingCallActionConfig>(
      "/incoming-call-action",
      params,
    );
    return parseIncomingCallActionConfig(data);
  }

  /**
   * Set the incoming-call routing config.
   *
   * @param options.incomingCallAction - `auto_accept`, `auto_reject`, or `webhook`.
   * @param options.agentIdentityId - UUID of the agent identity. Optional
   *   for agent-scoped keys; required under admin/JWT.
   * @param options.clientWebsocketUrl - WebSocket URL (wss://) to bridge
   *   accepted calls to.
   * @param options.incomingCallWebhookUrl - HTTPS URL that decides call
   *   routing when the action is `webhook`.
   */
  async set(options: {
    incomingCallAction: IncomingCallAction;
    agentIdentityId?: string;
    clientWebsocketUrl?: string;
    incomingCallWebhookUrl?: string;
  }): Promise<IncomingCallActionConfig> {
    const body: Record<string, unknown> = {
      incoming_call_action: options.incomingCallAction,
    };
    if (options.agentIdentityId !== undefined) {
      body["agent_identity_id"] = options.agentIdentityId;
    }
    if (options.clientWebsocketUrl !== undefined) {
      body["client_websocket_url"] = options.clientWebsocketUrl;
    }
    if (options.incomingCallWebhookUrl !== undefined) {
      body["incoming_call_webhook_url"] = options.incomingCallWebhookUrl;
    }
    const data = await this.http.put<RawIncomingCallActionConfig>(
      "/incoming-call-action",
      body,
    );
    return parseIncomingCallActionConfig(data);
  }
}
