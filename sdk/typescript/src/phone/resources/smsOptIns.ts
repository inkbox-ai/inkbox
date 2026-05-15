/**
 * inkbox-phone/resources/smsOptIns.ts
 *
 * SMS opt-in / opt-out registry (per-(org, receiver) consent state).
 *
 * Reads (`list`, `get`) are available to any admin or JWT caller.
 * Writes (`optIn`, `optOut`) are gated server-side to orgs that run
 * their own actively-used 10DLC campaign — orgs on the Inkbox-default
 * pool share consent state and can't override it through this API.
 * Calling `optIn` / `optOut` from a default-pool org rejects with a
 * 409 (`customer_campaign_required`).
 */

import { HttpTransport } from "../../_http.js";
import {
  RawSmsOptIn,
  SmsOptIn,
  SmsOptInStatus,
  parseSmsOptIn,
} from "../types.js";

const BASE = "/sms-opt-ins";

function path(receiverNumber?: string, action?: string): string {
  if (!receiverNumber) return BASE;
  if (!action) return `${BASE}/${receiverNumber}`;
  return `${BASE}/${receiverNumber}/${action}`;
}

export interface ListSmsOptInsOptions {
  status?: SmsOptInStatus;
  limit?: number;
  offset?: number;
}

export class SmsOptInsResource {
  constructor(private readonly http: HttpTransport) {}

  /** List the calling org's opt-in rows, newest-updated first. */
  async list(options: ListSmsOptInsOptions = {}): Promise<SmsOptIn[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.status !== undefined) params.status = options.status;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<
      { items: RawSmsOptIn[] } | RawSmsOptIn[]
    >(path(), params);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseSmsOptIn);
  }

  /** Get the opt-in row for one E.164 recipient. 404 if no row exists. */
  async get(receiverNumber: string): Promise<SmsOptIn> {
    const data = await this.http.get<RawSmsOptIn>(path(receiverNumber));
    return parseSmsOptIn(data);
  }

  /**
   * Mark a recipient as opted in. Admin-only; requires the calling
   * org to be on its own actively-used 10DLC campaign (409
   * `customer_campaign_required` otherwise). Server records an
   * audit event with `source=customer_api`.
   */
  async optIn(receiverNumber: string): Promise<SmsOptIn> {
    const data = await this.http.post<RawSmsOptIn>(
      path(receiverNumber, "opt-in"),
      {},
    );
    return parseSmsOptIn(data);
  }

  /** Mark a recipient as opted out. Same auth + campaign gate as `optIn`. */
  async optOut(receiverNumber: string): Promise<SmsOptIn> {
    const data = await this.http.post<RawSmsOptIn>(
      path(receiverNumber, "opt-out"),
      {},
    );
    return parseSmsOptIn(data);
  }
}
