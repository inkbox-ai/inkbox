import {
  DuplicateContactRuleError,
  InkboxAPIError,
  InkboxError,
  InkboxVaultKeyError,
  RedundantContactAccessGrantError,
} from "@inkbox/sdk";

function renderDetail(detail: string | Record<string, unknown>): string {
  return typeof detail === "string" ? detail : JSON.stringify(detail);
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
      } else if (err instanceof InkboxAPIError) {
        console.error(`Error: HTTP ${err.statusCode}: ${renderDetail(err.detail)}`);
        if (err.statusCode === 401) {
          console.error("Hint: Check your API key.");
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
      process.exit(1);
    }
  };
}
