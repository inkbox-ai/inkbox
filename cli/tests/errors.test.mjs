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

test("withErrorHandler renders the message from structured API details", async () => {
  const { lines, exitCode } = await runAndCapture(
    new InkboxAPIError(400, {
      error: "mail_import_invalid_request",
      message: "The import request is invalid.",
    }),
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(lines, ["Error: HTTP 400: The import request is invalid."]);
});

test("withErrorHandler renders the Support Agent escalation and checks", async () => {
  const agentSupport =
    "If you cannot resolve this issue, contact the Support Agent. " +
    "Agent Card: https://inkbox.ai/a2a/support/card. " +
    "Check GET https://inkbox.ai/api/v1/identities/{agent_handle}/a2a/settings.";
  const { lines, exitCode } = await runAndCapture(
    new InkboxAPIError(400, "bad request", null, agentSupport),
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(lines, [
    "Error: HTTP 400: bad request",
    `Support: ${agentSupport}`,
  ]);
});

for (const code of [
  "a2a_invitation_issuer_rate_limited",
  "a2a_invitation_issuer_outstanding_limit",
  "a2a_invitation_recipient_unavailable",
  "a2a_invitation_membership_verification_unavailable",
]) {
  test(`withErrorHandler renders invitation Retry-After guidance for ${code}`, async () => {
    const { lines, exitCode } = await runAndCapture(
      new InkboxAPIError(429, { code, message: "Try again later." }, 900),
    );

    assert.equal(exitCode, 1);
    assert.deepEqual(lines, [
      "Error: HTTP 429: Try again later.",
      "Hint: Retry in 900 seconds.",
    ]);
  });
}

test("withErrorHandler explains how to release an in-flight mailbox import", async () => {
  const { lines, exitCode } = await runAndCapture(
    new InkboxAPIError(409, {
      error: "mail_import_already_in_flight",
      message: "An import is already in flight for this mailbox.",
    }),
  );

  assert.equal(exitCode, 1);
  assert.equal(lines[0], "Error: HTTP 409: An import is already in flight for this mailbox.");
  assert.match(lines[1], /inkbox mailbox imports list <email>/);
  assert.match(lines[1], /inkbox mailbox imports cancel <email> <job-id>/);
});
