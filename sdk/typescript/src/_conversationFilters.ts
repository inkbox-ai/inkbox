/** Encode an optional any-participant or contact selector. */
export function conversationFilterParams(options?: {
  participants?: string[];
  contactId?: string;
}): Record<string, string | string[]> {
  if (options?.participants !== undefined && options.contactId !== undefined) {
    throw new Error("participants and contactId are mutually exclusive");
  }
  if (options?.participants !== undefined) {
    if (!Array.isArray(options.participants) || options.participants.length < 1 || options.participants.length > 100) {
      throw new Error("participants must contain between 1 and 100 addresses");
    }
    return { participants: [...options.participants] };
  }
  return options?.contactId !== undefined ? { contact_id: options.contactId } : {};
}
