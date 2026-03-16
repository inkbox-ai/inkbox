/**
 * inkbox-identities/resources/identities.ts
 *
 * Identity CRUD and channel assignment.
 */
import { HttpTransport } from "../../_http.js";
import { AgentIdentitySummary, _AgentIdentityData } from "../types.js";
export declare class IdentitiesResource {
    private readonly http;
    constructor(http: HttpTransport);
    /**
     * Create a new agent identity.
     *
     * @param options.agentHandle - Unique handle for this identity within your organisation
     *   (e.g. `"sales-agent"` or `"@sales-agent"`).
     */
    create(options: {
        agentHandle: string;
    }): Promise<AgentIdentitySummary>;
    /** List all identities for your organisation. */
    list(): Promise<AgentIdentitySummary[]>;
    /**
     * Get an identity with its linked channels (mailbox, phone number).
     *
     * @param agentHandle - Handle of the identity to fetch.
     */
    get(agentHandle: string): Promise<_AgentIdentityData>;
    /**
     * Update an identity's handle or status.
     *
     * Only provided fields are applied; omitted fields are left unchanged.
     *
     * @param agentHandle - Current handle of the identity to update.
     * @param options.newHandle - New handle value.
     * @param options.status - New lifecycle status: `"active"` or `"paused"`.
     */
    update(agentHandle: string, options: {
        newHandle?: string;
        status?: string;
    }): Promise<AgentIdentitySummary>;
    /**
     * Soft-delete an identity.
     *
     * Unlinks any assigned channels without deleting them.
     *
     * @param agentHandle - Handle of the identity to delete.
     */
    delete(agentHandle: string): Promise<void>;
    /**
     * Assign a mailbox to an identity.
     *
     * @param agentHandle - Handle of the identity.
     * @param options.mailboxId - UUID of the mailbox to assign.
     */
    assignMailbox(agentHandle: string, options: {
        mailboxId: string;
    }): Promise<_AgentIdentityData>;
    /**
     * Unlink the mailbox from an identity (does not delete the mailbox).
     *
     * @param agentHandle - Handle of the identity.
     */
    unlinkMailbox(agentHandle: string): Promise<void>;
    /**
     * Assign a phone number to an identity.
     *
     * @param agentHandle - Handle of the identity.
     * @param options.phoneNumberId - UUID of the phone number to assign.
     */
    assignPhoneNumber(agentHandle: string, options: {
        phoneNumberId: string;
    }): Promise<_AgentIdentityData>;
    /**
     * Unlink the phone number from an identity (does not delete the number).
     *
     * @param agentHandle - Handle of the identity.
     */
    unlinkPhoneNumber(agentHandle: string): Promise<void>;
}
//# sourceMappingURL=identities.d.ts.map