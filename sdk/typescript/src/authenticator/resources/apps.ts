/**
 * inkbox-authenticator/resources/apps.ts
 *
 * Authenticator app CRUD operations.
 */

import { HttpTransport } from "../../_http.js";
import {
  AuthenticatorApp,
  RawAuthenticatorApp,
  parseAuthenticatorApp,
} from "../types.js";

const BASE = "/apps";

export class AuthenticatorAppsResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Create a new authenticator app.
   *
   * @param options.agentHandle - Optional agent identity handle to link this app to.
   *   If omitted, the app is created unbound.
   */
  async create(options: { agentHandle?: string } = {}): Promise<AuthenticatorApp> {
    const body: Record<string, unknown> = {};
    if (options.agentHandle !== undefined) body["agent_handle"] = options.agentHandle;
    const data = await this.http.post<RawAuthenticatorApp>(BASE, body);
    return parseAuthenticatorApp(data);
  }

  /** List all non-deleted authenticator apps for your organisation. */
  async list(): Promise<AuthenticatorApp[]> {
    const data = await this.http.get<RawAuthenticatorApp[]>(BASE);
    return data.map(parseAuthenticatorApp);
  }

  /**
   * Get a single authenticator app by ID.
   *
   * @param authenticatorAppId - UUID of the authenticator app.
   */
  async get(authenticatorAppId: string): Promise<AuthenticatorApp> {
    const data = await this.http.get<RawAuthenticatorApp>(`${BASE}/${authenticatorAppId}`);
    return parseAuthenticatorApp(data);
  }

  /**
   * Soft-delete an authenticator app.
   *
   * This also unlinks the app from its identity (if any) and
   * soft-deletes all child authenticator accounts.
   *
   * @param authenticatorAppId - UUID of the authenticator app to delete.
   */
  async delete(authenticatorAppId: string): Promise<void> {
    await this.http.delete(`${BASE}/${authenticatorAppId}`);
  }
}
