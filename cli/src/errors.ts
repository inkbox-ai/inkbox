import {
  DuplicateContactRuleError,
  InkboxAPIError,
  InkboxError,
  InkboxVaultKeyError,
  MailImportQuotaExceededError,
  RedundantContactAccessGrantError,
  StorageLimitExceededError,
} from "@inkbox/sdk";

function importAlreadyInFlight(err: InkboxAPIError): boolean {
  return (
    err.statusCode === 409
    && typeof err.detail === "object"
    && err.detail !== null
    && err.detail["error"] === "mail_import_already_in_flight"
  );
}

function isA2AInvitationError(err: InkboxAPIError): boolean {
  return (
    typeof err.detail === "object"
    && err.detail !== null
    && typeof err.detail["code"] === "string"
    && err.detail["code"].startsWith("a2a_invitation_")
  );
}

/** Structured details carry a human sentence; printing the raw JSON helps nobody. */
function renderDetail(detail: string | Record<string, unknown>): string {
  if (typeof detail === "string") return detail;
  const message = detail?.message;
  return typeof message === "string" && message ? message : JSON.stringify(detail);
}

function renderAgentGuidance(err: InkboxAPIError): void {
  const guidance = err.agentGuidance;
  if (!guidance) return;
  if (guidance.reason !== renderDetail(err.detail)) {
    console.error(`Reason: ${guidance.reason}`);
  }
  guidance.nextSteps.forEach((step, index) => {
    console.error(`Next step ${index + 1}: ${step}`);
  });
  console.error(`Support Agent Card: ${guidance.support.agentCardUrl}`);
  console.error(
    "Support conversation requirements: active agent-scoped API key, claimed identity, "
      + "A2A enabled, and permission to contact @support.",
  );
}

export function withErrorHandler<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async function (this: unknown, ...args: T) {
    try {
      await fn.call(this, ...args);
    } catch (err) {
      if (err instanceof DuplicateContactRuleError) {
        console.error(
          `Error: HTTP ${err.statusCode}: duplicate rule (existing_rule_id=${err.existingRuleId})`,
        );
      } else if (err instanceof RedundantContactAccessGrantError) {
        console.error(
          `Error: HTTP ${err.statusCode}: redundant grant — ${err.detailMessage}`,
        );
      } else if (err instanceof StorageLimitExceededError) {
        console.error(
          `Error: HTTP ${err.statusCode}: ${err.detailMessage || renderDetail(err.detail)}`,
        );
        console.error(
          "Hint: Free space with 'inkbox email delete <message-id> -i <handle>' " +
            "or 'inkbox email delete-thread <thread-id> -i <handle>' " +
            "(reclaim is immediate), or upgrade the plan" +
            (err.upgradeUrl ? `: ${err.upgradeUrl}` : "."),
        );
      } else if (err instanceof MailImportQuotaExceededError) {
        console.error(`Error: HTTP ${err.statusCode}: ${err.detailMessage || renderDetail(err.detail)}`);
        if (err.retryAfterSeconds !== null) {
          console.error(`Hint: Retry in ${err.retryAfterSeconds} seconds.`);
        }
      } else if (err instanceof InkboxAPIError) {
        console.error(`Error: HTTP ${err.statusCode}: ${renderDetail(err.detail)}`);
        if (!err.agentGuidance && (
          err.statusCode === 429
          && isA2AInvitationError(err)
          && err.retryAfterSeconds !== null
        )) {
          console.error(`Hint: Retry in ${err.retryAfterSeconds} seconds.`);
        }
        if (err.statusCode === 401 && !err.agentGuidance) {
          console.error("Hint: Check your API key.");
        }
        if (importAlreadyInFlight(err)) {
          console.error(
            "Hint: List the mailbox's jobs with 'inkbox mailbox imports list <email>' " +
              "and release an abandoned one with 'inkbox mailbox imports cancel <email> <job-id>'.",
          );
        }
      } else if (err instanceof InkboxVaultKeyError) {
        console.error(`Error: ${err.message}`);
        console.error(
          "Hint: Set INKBOX_VAULT_KEY or pass --vault-key.",
        );
      } else if (err instanceof InkboxError) {
        console.error(`Error: ${err.message}`);
      } else if (err instanceof Error) {
        console.error(`Error: ${err.message}`);
      } else {
        console.error("An unknown error occurred.");
      }
      if (err instanceof InkboxAPIError) renderAgentGuidance(err);
      process.exit(1);
    }
  };
}
