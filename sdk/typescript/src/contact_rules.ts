/** Inbound/outbound list filters also include rules covering both directions. */
export type RuleDirection = "inbound" | "outbound" | "both";

/** @internal Serialize a coverage change or an atomic one-sided action edit. */
export function ruleUpdateToWire(options: {
  action?: string;
  direction?: RuleDirection;
  applyTo?: "inbound" | "outbound";
}): Record<string, unknown> {
  if (options.action === undefined && options.direction === undefined) {
    throw new TypeError("action or direction is required");
  }
  if (options.action === null || options.direction === null || options.applyTo === null) {
    throw new TypeError("Rule changes cannot be null");
  }
  if (options.applyTo !== undefined && (
    options.action === undefined || options.direction !== undefined
    || !["inbound", "outbound"].includes(options.applyTo)
  )) throw new TypeError("applyTo requires action and excludes direction; use inbound or outbound");
  return {
    ...(options.action !== undefined ? { action: options.action } : {}),
    ...(options.direction !== undefined ? { direction: options.direction } : {}),
    ...(options.applyTo !== undefined ? { apply_to: options.applyTo } : {}),
  };
}
