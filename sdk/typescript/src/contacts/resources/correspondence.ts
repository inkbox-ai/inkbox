import { HttpTransport } from "../../_http.js";
import {
  ContactCorrespondence,
  CorrespondenceChannel,
  CorrespondenceContentMode,
  CorrespondenceOrder,
  CorrespondenceTranscriptMode,
  RawContactCorrespondence,
  parseContactCorrespondence,
} from "../correspondence.js";

const BASE = "/contacts";

export interface ContactCorrespondenceOptions {
  channels?: CorrespondenceChannel[];
  after?: Date | string;
  before?: Date | string;
  limitPerChannel?: number;
  emailLimit?: number;
  smsLimit?: number;
  imessageLimit?: number;
  callsLimit?: number;
  cursor?: string;
  order?: CorrespondenceOrder;
  content?: CorrespondenceContentMode;
  transcripts?: CorrespondenceTranscriptMode;
  includeFailed?: boolean;
  identityId?: string;
}

export type GetContactCorrespondenceOptions = ContactCorrespondenceOptions;

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export class ContactCorrespondenceResource {
  constructor(private readonly http: HttpTransport) {}

  async get(
    contactId: string,
    options: ContactCorrespondenceOptions = {},
  ): Promise<ContactCorrespondence> {
    const params: Record<
      string,
      string | number | boolean | readonly string[] | undefined
    > = {
      channels: options.channels,
      after: options.after === undefined ? undefined : serializeDate(options.after),
      before: options.before === undefined ? undefined : serializeDate(options.before),
      limit_per_channel: options.limitPerChannel,
      email_limit: options.emailLimit,
      sms_limit: options.smsLimit,
      imessage_limit: options.imessageLimit,
      calls_limit: options.callsLimit,
      cursor: options.cursor,
      order: options.order,
      content: options.content,
      transcripts: options.transcripts,
      include_failed: options.includeFailed,
      identity_id: options.identityId,
    };
    const data = await this.http.get<RawContactCorrespondence>(
      `${BASE}/${contactId}/correspondence`,
      params,
    );
    return parseContactCorrespondence(data);
  }

  async list(
    contactId: string,
    options: ContactCorrespondenceOptions = {},
  ): Promise<ContactCorrespondence> {
    return this.get(contactId, options);
  }
}
