/** Optional cached context for retained Slack messages. */
export type SlackArchiveInclude = "conversation" | "sender" | "reactions" | "files";
export type SlackCachedMediaKind = "user" | "bot" | "emoji";
export interface SlackCachedActor {
  id: string; kind: "user" | "bot"; name: string | null;
  avatarUrl: string | null; avatarCached: boolean; deleted: boolean | null;
  status: string; fetchedAt: Date | null;
}
export interface SlackCachedConversation {
  id: string; name: string | null; title: string | null;
  type: "im" | "mpim" | "channel" | null; topic: string | null; purpose: string | null;
  counterpartUserId: string | null; memberIds: string[] | null; membersComplete: boolean | null;
  isArchived: boolean | null; isPrivate: boolean | null; status: string; fetchedAt: Date | null;
}
export interface SlackCachedEmoji {
  name: string; aliasOf: string | null; imageUrl: string | null; imageCached: boolean; status: string;
}
export interface SlackCachedFile {
  id: string; name: string | null; title: string | null; mimetype: string | null; size: number | null;
  contentCached: boolean; previewCached: boolean; previewUrl: string | null; status: string; errorCode: string | null;
}
/** Unknown totals stay null; known users need not be the complete actor set. */
export interface SlackCachedReaction {
  name: string; count: number | null; users: string[]; usersComplete: boolean; reacted: boolean | null;
}
export interface SlackArchiveIncluded {
  conversations: Record<string, SlackCachedConversation>;
  actors: Record<string, SlackCachedActor>;
  emoji: Record<string, SlackCachedEmoji>;
  files: Record<string, SlackCachedFile>;
}
export interface SlackCachedEmojiPage {
  emoji: SlackCachedEmoji[]; nextCursor: string | null; status: string; errorCode: string | null;
}
export interface SlackCachedEmojiOptions {
  q?: string; limit?: number; cursor?: string | null;
}
type Snake<S extends string> = S extends `${infer A}${infer B}`
  ? `${A extends Lowercase<A> ? A : `_${Lowercase<A>}`}${Snake<B>}` : S;
export type CachedWire<T> = { [K in keyof T as Snake<K & string>]:
  T[K] extends Date | null ? string | null : T[K] };
export interface RawArchiveIncluded {
  conversations?: Record<string, CachedWire<SlackCachedConversation>>;
  actors?: Record<string, CachedWire<SlackCachedActor>>;
  emoji?: Record<string, CachedWire<SlackCachedEmoji>>;
  files?: Record<string, CachedWire<SlackCachedFile>>;
}
export const cachedReaction = (r: CachedWire<SlackCachedReaction>): SlackCachedReaction => ({
  name: r.name, count: r.count ?? null, users: r.users ?? [], usersComplete: r.users_complete ?? false,
  reacted: r.reacted ?? null,
});
export const cachedEmoji = (r: CachedWire<SlackCachedEmoji>): SlackCachedEmoji => ({
  name: r.name, aliasOf: r.alias_of ?? null, imageUrl: r.image_url ?? null,
  imageCached: r.image_cached ?? false, status: r.status ?? "pending",
});
function mapValues<A, B>(values: Record<string, A> | undefined, convert: (v: A) => B): Record<string, B> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key, convert(value)]));
}
export const archiveIncluded = (r: RawArchiveIncluded): SlackArchiveIncluded => ({
  conversations: mapValues(r.conversations, c => ({
    id: c.id, name: c.name ?? null, title: c.title ?? null, type: c.type ?? null,
    topic: c.topic ?? null, purpose: c.purpose ?? null, counterpartUserId: c.counterpart_user_id ?? null,
    memberIds: c.member_ids ?? null, membersComplete: c.members_complete ?? null,
    isArchived: c.is_archived ?? null, isPrivate: c.is_private ?? null, status: c.status ?? "pending",
    fetchedAt: c.fetched_at ? new Date(c.fetched_at) : null,
  })),
  actors: mapValues(r.actors, a => ({
    id: a.id, kind: a.kind, name: a.name ?? null, avatarUrl: a.avatar_url ?? null,
    avatarCached: a.avatar_cached ?? false, deleted: a.deleted ?? null, status: a.status ?? "pending",
    fetchedAt: a.fetched_at ? new Date(a.fetched_at) : null,
  })),
  emoji: mapValues(r.emoji, cachedEmoji),
  files: mapValues(r.files, f => ({
    id: f.id, name: f.name ?? null, title: f.title ?? null, mimetype: f.mimetype ?? null,
    size: f.size ?? null, contentCached: f.content_cached ?? false, previewCached: f.preview_cached ?? false,
    previewUrl: f.preview_url ?? null, status: f.status ?? "pending", errorCode: f.error_code ?? null,
  })),
});
