/**
 * inkbox-notes/resources/notes.ts
 *
 * Notes CRUD + per-note access subresource.
 */

import { HttpTransport } from "../../_http.js";
import { NoteAccessResource } from "./noteAccess.js";
import { Note, RawNote, parseNote } from "../types.js";

const BASE = "/notes";

export interface ListNotesOptions {
  q?: string;
  identityId?: string;
  limit?: number;
  offset?: number;
  order?: "recent" | "created" | string;
}

export interface CreateNoteOptions {
  body: string;
  title?: string;
}

export interface UpdateNoteOptions {
  title?: string | null;
  body?: string;
}

export class NotesResource {
  readonly access: NoteAccessResource;

  constructor(private readonly http: HttpTransport) {
    this.access = new NoteAccessResource(http);
  }

  async list(options: ListNotesOptions = {}): Promise<Note[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.q !== undefined) params.q = options.q;
    if (options.identityId !== undefined) params.identity_id = options.identityId;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    if (options.order !== undefined) params.order = options.order;
    const data = await this.http.get<{ items: RawNote[] } | RawNote[]>(
      BASE,
      params,
    );
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseNote);
  }

  async get(noteId: string): Promise<Note> {
    const data = await this.http.get<RawNote>(`${BASE}/${noteId}`);
    return parseNote(data);
  }

  async create(options: CreateNoteOptions): Promise<Note> {
    const body: Record<string, unknown> = { body: options.body };
    if (options.title !== undefined) body.title = options.title;
    const data = await this.http.post<RawNote>(BASE, body);
    return parseNote(data);
  }

  /**
   * JSON-merge-patch update.
   *
   * `title: null` clears the title (server returns 200). Setting `body`
   * to null is **not** a legal operation — the server rejects with 422.
   */
  async update(noteId: string, options: UpdateNoteOptions): Promise<Note> {
    const body: Record<string, unknown> = {};
    if ("title" in options) body.title = options.title;
    if (options.body !== undefined) body.body = options.body;
    const data = await this.http.patch<RawNote>(`${BASE}/${noteId}`, body);
    return parseNote(data);
  }

  async delete(noteId: string): Promise<void> {
    await this.http.delete(`${BASE}/${noteId}`);
  }
}
