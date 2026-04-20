/**
 * inkbox-notes TypeScript SDK — public types.
 */

export interface NoteAccess {
  id: string;
  noteId: string;
  identityId: string;
  createdAt: Date;
}

export interface Note {
  id: string;
  organizationId: string;
  createdBy: string;
  title: string | null;
  body: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  access: NoteAccess[];
}

// ---- raw wire shapes ----

export interface RawNoteAccess {
  id: string;
  note_id: string;
  identity_id: string;
  created_at: string;
}

export interface RawNote {
  id: string;
  organization_id: string;
  created_by: string;
  title: string | null;
  body: string;
  status: string;
  created_at: string;
  updated_at: string;
  access?: RawNoteAccess[] | null;
}

// ---- parsers ----

export function parseNoteAccess(r: RawNoteAccess): NoteAccess {
  return {
    id: r.id,
    noteId: r.note_id,
    identityId: r.identity_id,
    createdAt: new Date(r.created_at),
  };
}

export function parseNote(r: RawNote): Note {
  return {
    id: r.id,
    organizationId: r.organization_id,
    createdBy: r.created_by,
    title: r.title,
    body: r.body,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    access: (r.access ?? []).map(parseNoteAccess),
  };
}
