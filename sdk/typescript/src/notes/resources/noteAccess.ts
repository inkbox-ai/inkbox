/**
 * inkbox-notes/resources/noteAccess.ts
 *
 * Per-note access grant management. No wildcards.
 */

import { HttpTransport } from "../../_http.js";
import { NoteAccess, RawNoteAccess, parseNoteAccess } from "../types.js";

const BASE = "/notes";

export class NoteAccessResource {
  constructor(private readonly http: HttpTransport) {}

  async list(noteId: string): Promise<NoteAccess[]> {
    const data = await this.http.get<
      { items: RawNoteAccess[] } | RawNoteAccess[]
    >(`${BASE}/${noteId}/access`);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseNoteAccess);
  }

  async grant(noteId: string, identityId: string): Promise<NoteAccess> {
    const data = await this.http.post<RawNoteAccess>(
      `${BASE}/${noteId}/access`,
      { identity_id: identityId },
    );
    return parseNoteAccess(data);
  }

  async revoke(noteId: string, identityId: string): Promise<void> {
    await this.http.delete(`${BASE}/${noteId}/access/${identityId}`);
  }
}
