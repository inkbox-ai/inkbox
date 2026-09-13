/** Validate bounded contact-policy pagination before sending a request. */
export function parsePolicyPagination(options: { limit: string; offset: string }): { limit: number; offset: number } {
  const limit = Number(options.limit);
  const offset = Number(options.offset);
  if (!/^\d+$/.test(options.limit) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("--limit must be an integer between 1 and 200");
  }
  if (!/^\d+$/.test(options.offset) || !Number.isSafeInteger(offset) || offset > 10000) {
    throw new Error("--offset must be an integer between 0 and 10000");
  }
  return { limit, offset };
}
