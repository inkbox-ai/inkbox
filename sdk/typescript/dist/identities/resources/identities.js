/**
 * inkbox-identities/resources/identities.ts
 *
 * Identity CRUD and channel assignment.
 */
import { parseAgentIdentitySummary, parseAgentIdentityData, } from "../types.js";
export class IdentitiesResource {
    http;
    constructor(http) {
        this.http = http;
    }
    /**
     * Create a new agent identity.
     *
     * @param options.agentHandle - Unique handle for this identity within your organisation
     *   (e.g. `"sales-agent"` or `"@sales-agent"`).
     */
    async create(options) {
        const data = await this.http.post("/", {
            agent_handle: options.agentHandle,
        });
        return parseAgentIdentitySummary(data);
    }
    /** List all identities for your organisation. */
    async list() {
        const data = await this.http.get("/");
        return data.map(parseAgentIdentitySummary);
    }
    /**
     * Get an identity with its linked channels (mailbox, phone number).
     *
     * @param agentHandle - Handle of the identity to fetch.
     */
    async get(agentHandle) {
        const data = await this.http.get(`/${agentHandle}`);
        return parseAgentIdentityData(data);
    }
    /**
     * Update an identity's handle or status.
     *
     * Only provided fields are applied; omitted fields are left unchanged.
     *
     * @param agentHandle - Current handle of the identity to update.
     * @param options.newHandle - New handle value.
     * @param options.status - New lifecycle status: `"active"` or `"paused"`.
     */
    async update(agentHandle, options) {
        const body = {};
        if (options.newHandle !== undefined)
            body["agent_handle"] = options.newHandle;
        if (options.status !== undefined)
            body["status"] = options.status;
        const data = await this.http.patch(`/${agentHandle}`, body);
        return parseAgentIdentitySummary(data);
    }
    /**
     * Soft-delete an identity.
     *
     * Unlinks any assigned channels without deleting them.
     *
     * @param agentHandle - Handle of the identity to delete.
     */
    async delete(agentHandle) {
        await this.http.delete(`/${agentHandle}`);
    }
    /**
     * Assign a mailbox to an identity.
     *
     * @param agentHandle - Handle of the identity.
     * @param options.mailboxId - UUID of the mailbox to assign.
     */
    async assignMailbox(agentHandle, options) {
        const data = await this.http.post(`/${agentHandle}/mailbox`, { mailbox_id: options.mailboxId });
        return parseAgentIdentityData(data);
    }
    /**
     * Unlink the mailbox from an identity (does not delete the mailbox).
     *
     * @param agentHandle - Handle of the identity.
     */
    async unlinkMailbox(agentHandle) {
        await this.http.delete(`/${agentHandle}/mailbox`);
    }
    /**
     * Assign a phone number to an identity.
     *
     * @param agentHandle - Handle of the identity.
     * @param options.phoneNumberId - UUID of the phone number to assign.
     */
    async assignPhoneNumber(agentHandle, options) {
        const data = await this.http.post(`/${agentHandle}/phone_number`, { phone_number_id: options.phoneNumberId });
        return parseAgentIdentityData(data);
    }
    /**
     * Unlink the phone number from an identity (does not delete the number).
     *
     * @param agentHandle - Handle of the identity.
     */
    async unlinkPhoneNumber(agentHandle) {
        await this.http.delete(`/${agentHandle}/phone_number`);
    }
}
//# sourceMappingURL=identities.js.map