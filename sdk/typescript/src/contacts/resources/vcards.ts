/**
 * inkbox-contacts/resources/vcards.ts
 *
 * vCard import / export.
 */

import { HttpTransport } from "../../_http.js";
import {
  ContactImportResult,
  ContactVCardExportResult,
  RawContactImportResult,
  RawContactVCardExportResult,
  parseContactImportResult,
  parseContactVCardExportResult,
} from "../types.js";

const BASE = "/contacts";
const VCARD_CONTENT_TYPE = "text/vcard";

export class VCardsResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Bulk-import vCards.
   *
   * @param content - Raw vCard text. Server caps payload at 5 MiB and 1000 cards;
   *   zero cards returns 422.
   * @param contentType - MIME type. Defaults to `text/vcard`; `text/x-vcard`
   *   is also accepted.
   */
  async import(
    content: string | Uint8Array,
    contentType: string = VCARD_CONTENT_TYPE,
  ): Promise<ContactImportResult> {
    const data = await this.http.postRaw<RawContactImportResult>(
      `${BASE}/import`,
      content,
      contentType,
    );
    return parseContactImportResult(data);
  }

  /** Export a single contact as vCard 4.0 text. */
  async export(contactId: string): Promise<string> {
    return this.http.getText(`${BASE}/${contactId}.vcf`, VCARD_CONTENT_TYPE);
  }

  /** Export up to 25 contacts as one vCard document. */
  async exportMany(contactIds: string[]): Promise<ContactVCardExportResult> {
    const data = await this.http.post<RawContactVCardExportResult>(`${BASE}/vcard-export`, {
      contact_ids: contactIds,
    });
    return parseContactVCardExportResult(data);
  }
}
