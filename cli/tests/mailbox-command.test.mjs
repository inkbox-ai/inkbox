import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import {
  MAIL_IMPORT_MAX_UPLOAD_BYTES,
  UNRESOLVED_MAIL_HOSTS_ERROR,
  assertImportFileSize,
  assertMailImportFormat,
  clientSettings,
  createImportProgressReporter,
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

test("resolveMailDomain maps every supported API host to its mail domain", () => {
  assert.equal(resolveMailDomain(undefined), "inkboxmail.com");
  assert.equal(resolveMailDomain(""), "inkboxmail.com");
  for (const [baseUrl, mailDomain] of [
    ["https://inkbox.ai/api/v1", "inkboxmail.com"],
    ["https://api.inkbox.ai/api/v1", "inkboxmail.com"],
    ["https://beta.inkbox.ai/api/v1", "beta.inkboxmail.com"],
    ["https://api.beta.inkbox.ai/api/v1", "beta.inkboxmail.com"],
    ["https://development.inkbox.ai/api/v1", "development.inkboxmail.com"],
    ["https://api.development.inkbox.ai/api/v1", "development.inkboxmail.com"],
  ]) {
    assert.equal(resolveMailDomain(baseUrl), mailDomain, baseUrl);
  }
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

test("mailbox import helpers validate formats and the 1 GiB cap", async () => {
  assert.equal(assertMailImportFormat("zip"), "zip");
  assert.throws(() => assertMailImportFormat("tar"), /auto, mbox, eml, or zip/);

  const dir = mkdtempSync(join(tmpdir(), "inkbox-import-test-"));
  const path = join(dir, "mail.eml");
  const { writeFileSync, truncateSync } = await import("node:fs");
  writeFileSync(path, "Subject: Test\n\nBody");
  assert.equal(await assertImportFileSize(path), 19);
  truncateSync(path, MAIL_IMPORT_MAX_UPLOAD_BYTES + 1);
  await assert.rejects(assertImportFileSize(path), /maximum/);
});

test("mailbox import progress writes only changed status or counters", () => {
  const lines = [];
  const report = createImportProgressReporter((line) => lines.push(line));
  const job = {
    id: "job-1",
    status: "running",
    messagesProcessed: 2,
    messagesImported: 1,
    messagesSkippedDuplicate: 1,
    messagesFailed: 0,
    messagesRejectedUnsafe: 0,
  };
  report(job);
  report(job);
  report({ ...job, messagesProcessed: 3, messagesRejectedUnsafe: 1 });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /processed=2 imported=1 duplicates=1 failed=0 unsafe=0/);
  assert.match(lines[1], /processed=3.*unsafe=1/);
});

test("mailbox imports command exposes the complete lifecycle", () => {
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const help = execFileSync(process.execPath, [cli, "mailbox", "imports", "--help"], {
    encoding: "utf8",
  });
  for (const command of ["run", "get", "list", "wait", "cancel"]) {
    assert.match(help, new RegExp(`\\b${command}\\b`));
  }
});

test("mailbox imports run keeps JSON on stdout, progress on stderr, and upload unauthenticated", async () => {
  const email = "archive@example.com";
  const job = {
    id: "11111111-1111-1111-1111-111111111111",
    mailbox_id: "22222222-2222-2222-2222-222222222222",
    status: "completed",
    source_format: "eml",
    original_addresses: null,
    mark_as_read: true,
    upload_size_bytes: 19,
    messages_processed: 1,
    messages_imported: 1,
    messages_skipped_duplicate: 0,
    messages_failed: 0,
    messages_rejected_unsafe: 0,
    error_detail: null,
    created_at: "2026-07-24T12:00:00Z",
    updated_at: "2026-07-24T12:01:00Z",
    started_at: "2026-07-24T12:00:10Z",
    finished_at: "2026-07-24T12:01:00Z",
  };
  let uploadApiKey;
  const server = createServer((req, res) => {
    if (req.url === "/upload") {
      uploadApiKey = req.headers["x-api-key"];
      req.resume();
      res.writeHead(204).end();
      return;
    }
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === `/api/v1/mail/mailboxes/${email}/imports`) {
      res.writeHead(201).end(JSON.stringify({
        job: { ...job, status: "pending_upload", finished_at: null },
        upload: { url: `http://127.0.0.1:${server.address().port}/upload`, fields: { key: "k" }, expires_in_seconds: 60 },
      }));
    } else {
      res.writeHead(200).end(JSON.stringify(job));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const dir = mkdtempSync(join(tmpdir(), "inkbox-import-run-test-"));
  const path = join(dir, "message.eml");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path, "Subject: Test\n\nBody");
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const child = spawn(process.execPath, [
    cli,
    "--json",
    "--api-key", "ApiKey_test",
    "--base-url", `http://127.0.0.1:${server.address().port}`,
    "mailbox", "imports", "run", email, path,
    "--source-format", "eml",
    "--poll-interval", "0.01",
  ]);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [exitCode] = await once(child, "close");
  server.close();

  assert.equal(exitCode, 0);
  assert.equal(JSON.parse(stdout).status, "completed");
  assert.match(stderr, /Uploading message\.eml/);
  assert.match(stderr, /processed=1 imported=1/);
  assert.equal(uploadApiKey, undefined);
});

test("mailbox imports wait prints the failed job and exits nonzero", async () => {
  const job = {
    id: "11111111-1111-1111-1111-111111111111",
    mailbox_id: "22222222-2222-2222-2222-222222222222",
    status: "failed",
    source_format: "eml",
    original_addresses: null,
    mark_as_read: true,
    upload_size_bytes: 19,
    messages_processed: 0,
    messages_imported: 0,
    messages_skipped_duplicate: 0,
    messages_failed: 0,
    messages_rejected_unsafe: 0,
    error_detail: "Import could not be completed.",
    created_at: "2026-07-24T12:00:00Z",
    updated_at: "2026-07-24T12:01:00Z",
    started_at: "2026-07-24T12:00:10Z",
    finished_at: "2026-07-24T12:01:00Z",
  };
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(job));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const child = spawn(process.execPath, [
    cli,
    "--json",
    "--api-key", "ApiKey_test",
    "--base-url", `http://127.0.0.1:${server.address().port}`,
    "mailbox", "imports", "wait", "archive@example.com", job.id,
    "--poll-interval", "0.01",
  ]);
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  const [exitCode] = await once(child, "close");
  server.close();

  assert.equal(exitCode, 1);
  assert.equal(JSON.parse(stdout).status, "failed");
});
