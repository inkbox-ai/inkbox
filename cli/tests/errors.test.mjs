import assert from "node:assert/strict";
import test from "node:test";
import { InkboxAPIError, StorageLimitExceededError } from "@inkbox/sdk";
import { withErrorHandler } from "../dist/errors.js";

const BILLING_URL = "https://inkbox.ai/console/billing";

// withErrorHandler writes to console.error and exits; capture both.
async function runAndCapture(err) {
  const lines = [];
  const origError = console.error;
  const origExit = process.exit;
  let exitCode = null;
  console.error = (...args) => lines.push(args.join(" "));
  process.exit = (code) => {
    exitCode = code;
  };
  try {
    await withErrorHandler(async () => {
      throw err;
    })();
  } finally {
    console.error = origError;
    process.exit = origExit;
  }
  return { lines, exitCode };
}

test("withErrorHandler renders a 402 storage-limit error with a free-space hint", async () => {
  const { lines, exitCode } = await runAndCapture(
    new StorageLimitExceededError(402, {
      error: "storage_limit_exceeded",
      message:
        "This inbox has reached its storage limit of 2 GiB. Delete messages " +
        `to free space, or upgrade your plan for more: ${BILLING_URL}`,
      upgrade_url: BILLING_URL,
      limit_bytes: 2147483648,
    }),
  );

  assert.equal(exitCode, 1);
  assert.match(
    lines[0],
    /^Error: HTTP 402: This inbox has reached its storage limit of 2 GiB\./,
  );
  // Both delete commands require -i/--identity, so the hint must be copy-pastable.
  assert.match(lines[1], /inkbox email delete <message-id> -i <handle>/);
  assert.match(lines[1], /inkbox email delete-thread <thread-id> -i <handle>/);
  assert.ok(lines[1].endsWith(BILLING_URL));
});

test("withErrorHandler degrades to the generic API error for a string 402 (old server)", async () => {
  const { lines, exitCode } = await runAndCapture(
    new InkboxAPIError(402, "This inbox has reached its storage limit."),
  );

  assert.equal(exitCode, 1);
  assert.equal(
    lines[0],
    "Error: HTTP 402: This inbox has reached its storage limit.",
  );
  assert.equal(lines.length, 1); // no storage hint on an untyped 402
});
