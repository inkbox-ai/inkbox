export type ContactFactCitationAvailability =
  | "available"
  | "purged"
  | "source_unavailable_to_caller";

export type ContactFactOrigin = "generated" | "user";

/**
 * Which memory bucket a fact belongs to: who the contact is (`profile`), a
 * standing instruction (`preference`), or a live situation that stops applying
 * on its own (`context`).
 */
export type ContactFactKind = "profile" | "preference" | "context";

export interface ContactFactCitation {
  sourceType: string;
  availability: ContactFactCitationAvailability;
  sourceId: string | null;
  sourceUrl: string | null;
  sourceLocator: Record<string, unknown> | null;
}

export interface ContactFact {
  id: string;
  contactId: string;
  content: string;
  confidence: number | null;
  origin: ContactFactOrigin;
  lockedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  citations: ContactFactCitation[];
  /** Memory bucket the fact belongs to, when it has been classified. */
  kind?: ContactFactKind | null;
  /** When the fact stops applying; only extracted `context` facts carry one. */
  expiresAt?: Date | null;
}

export interface ContactFactCitationDetail {
  sourceType: string;
  sourceId: string;
  sourceLocator: Record<string, unknown>;
  sourceUrl: string | null;
}

export interface ContactFactDeleteResult {
  deletedFactId: string;
  memoryCount: number;
  latestMemory: {
    id: string;
    content: string;
    updatedAt: Date;
  } | null;
}

export interface RawContactFactCitation {
  source_type: string;
  availability: ContactFactCitationAvailability;
  source_id: string | null;
  source_url: string | null;
  source_locator: Record<string, unknown> | null;
}

export interface RawContactFact {
  id: string;
  contact_id: string;
  content: string;
  confidence: string | number | null;
  origin: ContactFactOrigin;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  citations: RawContactFactCitation[];
  kind?: ContactFactKind | null;
  expires_at?: string | null;
}

export interface RawContactFactCitationDetail {
  source_type: string;
  source_id: string;
  source_locator: Record<string, unknown>;
  source_url: string | null;
}

export interface RawContactFactDeleteResult {
  deleted_fact_id: string;
  memory_count: number;
  latest_memory: {
    id: string;
    content: string;
    updated_at: string;
  } | null;
}

export function parseContactFactCitation(r: RawContactFactCitation): ContactFactCitation {
  return {
    sourceType: r.source_type,
    availability: r.availability,
    sourceId: r.source_id,
    sourceUrl: r.source_url,
    sourceLocator: r.source_locator,
  };
}

export function parseContactFact(r: RawContactFact): ContactFact {
  return {
    id: r.id,
    contactId: r.contact_id,
    content: r.content,
    confidence: r.confidence === null ? null : Number(r.confidence),
    origin: r.origin,
    lockedAt: r.locked_at ? new Date(r.locked_at) : null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    citations: r.citations.map(parseContactFactCitation),
    kind: r.kind ?? null,
    expiresAt: r.expires_at ? new Date(r.expires_at) : null,
  };
}

export function parseContactFactCitationDetail(
  r: RawContactFactCitationDetail,
): ContactFactCitationDetail {
  return {
    sourceType: r.source_type,
    sourceId: r.source_id,
    sourceLocator: r.source_locator,
    sourceUrl: r.source_url,
  };
}

export function parseContactFactDeleteResult(
  r: RawContactFactDeleteResult,
): ContactFactDeleteResult {
  return {
    deletedFactId: r.deleted_fact_id,
    memoryCount: r.memory_count,
    latestMemory: r.latest_memory
      ? {
          id: r.latest_memory.id,
          content: r.latest_memory.content,
          updatedAt: new Date(r.latest_memory.updated_at),
        }
      : null,
  };
}
