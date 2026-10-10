import type { AgentIdentity, Inkbox, UpdateIdentityOptions } from "../dist/index.js";

declare const client: Inkbox;
declare const identity: AgentIdentity;

const profile: UpdateIdentityOptions = { displayName: "Sales assistant", description: null };
void client.identities.update("sales-agent", profile);
void identity.update(profile);

// @ts-expect-error Handles cannot be replaced through identity updates.
void client.identities.update("sales-agent", { newHandle: "other-agent" });
// @ts-expect-error The identity facade has the same read-only handle contract.
void identity.update({ newHandle: "other-agent" });
