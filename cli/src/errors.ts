import {
  DuplicateContactRuleError,
  InkboxAPIError,
  InkboxError,
  InkboxVaultKeyError,
  MailImportQuotaExceededError,
  RedundantContactAccessGrantError,
  StorageLimitExceededError,
} from "@inkbox/sdk";
import type { Command } from "commander";
import { getGlobalOpts } from "./client.js";

function importAlreadyInFlight(err: InkboxAPIError): boolean {
  return (
    err.statusCode === 409
    && typeof err.detail === "object"
    && err.detail !== null
    && err.detail["error"] === "mail_import_already_in_flight"
  );
}

function renderDetail(detail: string | Record<string, unknown>): string {
  if (typeof detail === "string") return detail;
  const message = detail?.message;
  const code = detail?.error;
  if (typeof code === "string" && code) {
    return typeof message === "string" && message ? `${code}: ${message}` : code;
  }
  return typeof message === "string" && message ? message : JSON.stringify(detail);
}

function renderAgentSupport(err: InkboxAPIError): void {
  if (err.agentSupport) console.error(`Support: ${err.agentSupport}`);
}

function wantsJson(command: unknown): boolean {
  return !!command && typeof (command as Command).opts === "function"
    && !!getGlobalOpts(command as Command).json;
}

function renderJsonError(err: unknown): void {
  if (err instanceof InkboxAPIError) {
    console.error(JSON.stringify({
      error: {
        type: err.name,
        message: renderDetail(err.detail),
        statusCode: err.statusCode,
        detail: err.detail,
        retryAfterSeconds: err.retryAfterSeconds,
        agentSupport: err.agentSupport,
      },
    }));
    return;
  }
  if (err instanceof Error) {
    console.error(JSON.stringify({ error: { type: err.name, message: err.message } }));
    return;
  }
  console.error(JSON.stringify({ error: { type: "UnknownError", message: "An unknown error occurred." } }));
}

export function withErrorHandler<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async function (this: unknown, ...args: T) {
    try {
      await fn.call(this, ...args);
    } catch (err) {
      if (wantsJson(this)) {
        renderJsonError(err);
      } else if (err instanceof DuplicateContactRuleError) {
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
        if (err.retryAfterSeconds !== null) {
          console.error(`Hint: Retry in ${err.retryAfterSeconds} seconds.`);
        }
        if (err.statusCode === 401) {
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
      if (!wantsJson(this) && err instanceof InkboxAPIError) renderAgentSupport(err);
      process.exit(1);
    }
  };
}
