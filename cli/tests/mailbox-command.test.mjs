import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UNRESOLVED_MAIL_HOSTS_ERROR,
  clientSettings,
  formatBytes,
  formatStorage,
  mailboxGetRecord,
  mailboxListRow,
  resolveMailDomain,
} from "../dist/commands/mailbox.js";

const MAILBOX = {
  id: "mbx_1",
  emailAddress: "sales-bot@inkboxmail.com",
  sendingDomain: "inkboxmail.com",
  filterMode: "blacklist",
  agentIdentityId: "id_1",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  filterModeChangeNotice: null,
  storageUsedBytes: 1_288_490_188, // 1.2 GiB
  storageLimitBytes: 2_147_483_648, // 2 GiB
};

test("formatBytes uses binary units", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1 KiB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5 MiB");
  assert.equal(formatBytes(1_288_490_188), "1.2 GiB");
  assert.equal(formatBytes(2 * 1024 ** 3), "2 GiB");
  assert.equal(formatBytes(4 * 1024 ** 3), "4 GiB");
});

test("formatStorage renders used / limit, dashing an unresolved cap", () => {
  assert.equal(formatStorage(1_288_490_188, 4 * 1024 ** 3), "1.2 GiB / 4 GiB");
  assert.equal(formatStorage(0, 2 * 1024 ** 3), "0 B / 2 GiB");
  assert.equal(formatStorage(1_288_490_188, null), "1.2 GiB / -");
  assert.equal(formatStorage(0, null), "0 B / -");
});

test("mailboxListRow adds a humanized storage column, keeping the raw fields", () => {
  const row = mailboxListRow(MAILBOX);
  assert.equal(row.storage, "1.2 GiB / 2 GiB");
  assert.equal(row.emailAddress, "sales-bot@inkboxmail.com");
  assert.equal(row.storageUsedBytes, 1_288_490_188);
  assert.equal(row.storageLimitBytes, 2_147_483_648);
});

test("mailboxGetRecord exposes raw bytes, and humanizes only for the table", () => {
  const human = mailboxGetRecord(MAILBOX, { humanize: true });
  assert.equal(human.storageUsedBytes, 1_288_490_188);
  assert.equal(human.storageLimitBytes, 2_147_483_648);
  assert.equal(human.storage, "1.2 GiB / 2 GiB");

  const json = mailboxGetRecord(MAILBOX, { humanize: false });
  assert.equal(json.storageUsedBytes, 1_288_490_188);
  assert.equal(json.storageLimitBytes, 2_147_483_648);
  assert.equal(json.storage, undefined);
});

test("mailboxGetRecord tolerates an old server (0 / null)", () => {
  const record = mailboxGetRecord(
    { ...MAILBOX, storageUsedBytes: 0, storageLimitBytes: null },
    { humanize: true },
  );
  assert.equal(record.storageLimitBytes, null);
  assert.equal(record.storage, "0 B / -");
});

test("resolveMailDomain maps the Inkbox API host to the mail domain", () => {
  assert.equal(resolveMailDomain(undefined), "inkboxmail.com");
  assert.equal(resolveMailDomain(""), "inkboxmail.com");
  assert.equal(resolveMailDomain("https://inkbox.ai"), "inkboxmail.com");
  assert.equal(resolveMailDomain("https://api.inkbox.ai"), "inkboxmail.com");
  assert.equal(resolveMailDomain("https://API.Inkbox.AI/api/v1"), "inkboxmail.com");
});

test("resolveMailDomain returns null for a base URL it cannot map, never guessing", () => {
  for (const unknown of [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "https://api.example.com",
    "https://inkbox.ai.example.com", // suffix confusion must not match
    "not-a-url",
  ]) {
    assert.equal(resolveMailDomain(unknown), null, unknown);
  }
});

test("clientSettings prints hosts and the username, never a password", () => {
  const settings = clientSettings(
    "sales-bot@inkboxmail.com",
    resolveMailDomain("https://inkbox.ai"),
  );
  assert.equal(settings.imapHost, "imap.inkboxmail.com");
  assert.equal(settings.imapPort, 993);
  assert.equal(settings.smtpHost, "smtp.inkboxmail.com");
  assert.equal(settings.smtpPort, 465);
  assert.equal(settings.smtpPortStarttls, 587);
  assert.equal(settings.username, "sales-bot@inkboxmail.com");
  assert.match(settings.password, /identity-scoped API key/);
});

// The guard that matters: pointed at an API base URL we can't map, the command must
// fail loudly instead of handing a mail client hosts it guessed.
test("client-settings prints no hosts for an unmappable API base URL", () => {
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(
      process.execPath,
      [cli, "mailbox", "client-settings", "sales-bot@inkboxmail.com"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          // A homedir with no ~/.inkbox/config, so only these vars decide the base URL.
          HOME: mkdtempSync(join(tmpdir(), "inkbox-cli-test-")),
          INKBOX_API_KEY: "ApiKey_test",
          INKBOX_BASE_URL: "http://localhost:8000",
        },
      },
    );
  } catch (err) {
    exitCode = err.status;
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? "";
  }
  assert.equal(exitCode, 1);
  assert.equal(stdout.trim(), "");
  assert.match(stderr, /Can't determine the mail hosts for this API base URL/);
  assert.doesNotMatch(stdout + stderr, /imap\.|smtp\.|inkboxmail\.com/);
});

test("UNRESOLVED_MAIL_HOSTS_ERROR names no hosts", () => {
  assert.doesNotMatch(UNRESOLVED_MAIL_HOSTS_ERROR, /inkbox(mail)?\.(ai|com)/);
});
