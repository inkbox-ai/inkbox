import { InkboxAPIError, InkboxError, InkboxVaultKeyError } from "@inkbox/sdk";

export function withErrorHandler<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async function (this: unknown, ...args: T) {
    try {
      await fn.call(this, ...args);
    } catch (err) {
      if (err instanceof InkboxAPIError) {
        console.error(`Error: HTTP ${err.statusCode}: ${err.detail}`);
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
