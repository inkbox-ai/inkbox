import { createHash } from "node:crypto";

export function eveDeliveryKey(threadId: string, messageId: string): string {
  // Eve limits admission keys to 256 characters; adapter IDs can be longer.
  return createHash("sha256")
    .update(JSON.stringify([threadId, messageId]))
    .digest("hex");
}
