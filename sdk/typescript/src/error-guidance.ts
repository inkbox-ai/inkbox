/** @internal Return non-empty Support Agent instructions and ignore malformed values. */
export function parseAgentSupport(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
