import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const email = "actual-mailbox@example.com";
const draftId = "11111111-1111-1111-1111-111111111111";

const identity = {
  id: "eeee5555-0000-0000-0000-000000000001",
  organization_id: "org-test",
  agent_handle: "writer",
  email_address: "stale-address@example.com",
  created_at: "2026-08-17T09:00:00Z",
  updated_at: "2026-08-17T09:00:00Z",
  mailbox: {
    id: "22222222-2222-2222-2222-222222222222",
    email_address: email,
    agent_identity_id: "eeee5555-0000-0000-0000-000000000001",
    created_at: "2026-08-17T09:00:00Z",
    updated_at: "2026-08-17T09:00:00Z",
  },
  phone_number: null,
  imessage_number: null,
  tunnel: null,
};

const summary = {
  id: draftId,
  mailbox_id: identity.mailbox.id,
  from_address: email,
  to_addresses: ["one@example.com", "two@example.com"],
  cc_addresses: [],
  bcc_addresses: [],
  subject: "Draft subject",
  snippet: "Draft body",
  has_attachments: true,
  attachment_count: 2,
  generation: 4,
  send_state: "draft",
  track_opens: false,
  created_at: "2026-08-17T10:00:00Z",
  updated_at: "2026-08-17T11:00:00Z",
};

const detail = {
  ...summary,
  body_text: "Draft body",
  body_html: null,
  reply_to: null,
  thread_id: null,
  message_id: "<draft@example.com>",
  in_reply_to: null,
  references: [],
  forward_source_message_id: null,
  forward_note_text: null,
  forward_note_html: null,
  attachment_metadata: [{
    part_index: 2,
    filename: "report.txt",
    content_type: "text/plain",
    size: 3,
    content_id: null,
    is_inline: false,
  }],
};

const message = {
  id: "bbbb2222-0000-0000-0000-000000000001",
  mailbox_id: identity.mailbox.id,
  thread_id: "eeee5555-0000-0000-0000-000000000002",
  message_id: "<sent@example.com>",
  from_address: email,
  to_addresses: ["one@example.com"],
  cc_addresses: null,
  subject: "Draft subject",
  snippet: "Draft body",
  direction: "outbound",
  status: "queued",
  is_read: true,
  is_starred: false,
  has_attachments: false,
  created_at: "2026-08-17T12:00:00Z",
  import_job_id: null,
};

function help(...args) {
  return execFileSync(process.execPath, [cli, ...args, "--help"], { encoding: "utf8" });
}

function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], {
      env: {
        ...process.env,
        HOME: mkdtempSync(join(tmpdir(), "inkbox-draft-test-")),
        NODE_USE_ENV_PROXY: "0",
      },
      timeout: 15_000,
    }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function json(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

async function requestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : undefined;
}

async function withMock(handler, callback) {
  const mock = await listen(async (req, res) => {
    if (req.method === "GET" && req.url === "/api/v1/identities/writer") {
      json(res, identity);
      return;
    }
    await handler(req, res);
  });
  try {
    return await callback(`http://127.0.0.1:${mock.port}`);
  } finally {
    mock.server.close();
  }
}

function args(baseUrl, ...command) {
  return ["--api-key", "test-key", "--base-url", baseUrl, ...command];
}

test("draft help exposes the complete command tree and mutation requirements", () => {
  const drafts = help("email", "drafts");
  for (const command of ["list", "create", "get", "update", "duplicate", "send", "delete", "attachment"]) {
    assert.match(drafts, new RegExp(`\\b${command}\\b`));
  }
  const attachments = help("email", "drafts", "attachment");
  for (const command of ["add", "remove", "download"]) {
    assert.match(attachments, new RegExp(`\\b${command}\\b`));
  }
  assert.match(help("email", "drafts", "update"), /--generation <n>/);
  assert.match(help("email", "drafts", "update"), /--clear-subject/);
  assert.match(help("email", "drafts", "attachment", "download"), /--output <path>/);
  for (const command of ["duplicate", "send", "delete"]) {
    assert.match(help("email", "drafts", command), /--generation <n>/);
  }
  for (const command of ["add", "remove", "download"]) {
    assert.match(help("email", "drafts", "attachment", command), /--generation <n>/);
  }
});

test("create supports an incomplete draft and uses the identity mailbox address", async () => {
  let request;
  await withMock(async (req, res) => {
    request = { method: req.method, url: req.url, body: await requestBody(req) };
    json(res, detail, 201);
  }, async (baseUrl) => {
    const result = await runCli(args(baseUrl, "--json", "email", "drafts", "create", "-i", "writer"));
    assert.ifError(result.error);
    assert.deepEqual(request, {
      method: "POST",
      url: `/api/v1/mail/mailboxes/${email}/drafts`,
      body: {},
    });
    assert.equal(JSON.parse(result.stdout).id, draftId);
  });
});

test("create sends an idempotency key header", async () => {
  let request;
  await withMock(async (req, res) => {
    request = {
      method: req.method,
      url: req.url,
      idempotencyKey: req.headers["idempotency-key"],
      body: await requestBody(req),
    };
    json(res, detail, 201);
  }, async (baseUrl) => {
    const result = await runCli(args(
      baseUrl,
      "--json", "email", "drafts", "create", "-i", "writer",
      "--subject", "Retryable", "--idempotency-key", "draft-create-1",
    ));
    assert.ifError(result.error);
  });
  assert.deepEqual(request, {
    method: "POST",
    url: `/api/v1/mail/mailboxes/${email}/drafts`,
    idempotencyKey: "draft-create-1",
    body: { subject: "Retryable" },
  });
});

test("create serializes recipients, reply fields, files, inline images, and false booleans", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inkbox-draft-files-"));
  const attachment = join(dir, "notes.txt");
  const image = join(dir, "pixel.png");
  writeFileSync(attachment, Buffer.from([0, 1, 2]));
  writeFileSync(image, Buffer.from([3, 4, 5]));
  let body;
  await withMock(async (req, res) => {
    body = await requestBody(req);
    json(res, detail, 201);
  }, async (baseUrl) => {
    const result = await runCli(args(
      baseUrl,
      "--json", "email", "drafts", "create", "-i", "writer",
      "--to", "one@example.com, two@example.com",
      "--cc", "cc@example.com",
      "--bcc", "bcc@example.com",
      "--subject", "Subject",
      "--body-text", "Text",
      "--body-html", "<img src=\"cid:pixel\">",
      "--reply-to", "reply@example.com",
      "--thread-id", "thread-1",
      "--in-reply-to", "message-1",
      "--references", "ref-1, ref-2",
      "--no-track-opens",
      "--attach", attachment,
      "--inline-image", `pixel=${image}`,
    ));
    assert.ifError(result.error);
  });
  assert.deepEqual(body, {
    recipients: {
      to: ["one@example.com", "two@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
    },
    subject: "Subject",
    body_text: "Text",
    body_html: "<img src=\"cid:pixel\">",
    reply_to: "reply@example.com",
    thread_id: "thread-1",
    in_reply_to_message_id: "message-1",
    references: ["ref-1", "ref-2"],
    attachments: [
      { filename: "notes.txt", content_type: "text/plain", content_base64: "AAEC" },
      {
        filename: "pixel.png",
        content_type: "image/png",
        content_base64: "AwQF",
        content_id: "pixel",
      },
    ],
    track_opens: false,
  });
});

test("create serializes forward fields without reply or inline content", async () => {
  let body;
  await withMock(async (req, res) => {
    body = await requestBody(req);
    json(res, detail, 201);
  }, async (baseUrl) => {
    const result = await runCli(args(
      baseUrl,
      "--json", "email", "drafts", "create", "-i", "writer",
      "--to", "one@example.com",
      "--subject", "Forward",
      "--forward-message-id", "source-1",
      "--forward-mode", "wrapped",
      "--no-include-original-attachments",
      "--forward-note-text", "Forward text",
      "--forward-note-html", "<p>Forward</p>",
    ));
    assert.ifError(result.error);
  });
  assert.deepEqual(body, {
    recipients: { to: ["one@example.com"] },
    subject: "Forward",
    forward_message_id: "source-1",
    forward_mode: "wrapped",
    include_original_attachments: false,
    forward_note_text: "Forward text",
    forward_note_html: "<p>Forward</p>",
  });
});

test("update preserves omitted fields while sending clears and explicit false", async () => {
  let request;
  await withMock(async (req, res) => {
    request = { method: req.method, url: req.url, body: await requestBody(req) };
    json(res, detail);
  }, async (baseUrl) => {
    const result = await runCli(args(
      baseUrl,
      "--json", "email", "drafts", "update", draftId, "-i", "writer",
      "--generation", "4",
      "--to", "new@example.com",
      "--clear-subject",
      "--body-text", "Replacement",
      "--clear-references",
      "--no-track-opens",
    ));
    assert.ifError(result.error);
  });
  assert.deepEqual(request, {
    method: "PATCH",
    url: `/api/v1/mail/mailboxes/${email}/drafts/${draftId}`,
    body: {
      generation: 4,
      recipients: { to: ["new@example.com"] },
      subject: null,
      body_text: "Replacement",
      references: null,
      track_opens: false,
    },
  });
});

test("update validates clear conflicts, empty changes, and generation", async () => {
  const conflict = await runCli([
    "--api-key", "test-key", "email", "drafts", "update", draftId,
    "-i", "writer", "--generation", "1", "--subject", "x", "--clear-subject",
  ]);
  assert.ok(conflict.error);
  assert.match(conflict.stderr, /--subject and --clear-subject cannot be combined/);

  const empty = await runCli([
    "--api-key", "test-key", "email", "drafts", "update", draftId,
    "-i", "writer", "--generation", "1",
  ]);
  assert.ok(empty.error);
  assert.match(empty.stderr, /Pass at least one field to update or clear/);

  const generation = await runCli([
    "--api-key", "test-key", "email", "drafts", "delete", draftId,
    "-i", "writer", "--generation", "zero",
  ]);
  assert.ok(generation.error);
  assert.match(generation.stderr, /must be a positive integer/);
  assert.doesNotMatch(generation.stderr, /at Option\.|node_modules/);

  const index = await runCli([
    "--api-key", "test-key", "email", "drafts", "attachment", "remove", draftId, "invalid",
    "-i", "writer", "--generation", "1",
  ]);
  assert.ok(index.error);
  assert.match(index.stderr, /Part index must be a non-negative integer/);
});

test("create rejects incomplete forward combinations before making a request", async () => {
  const missingSource = await runCli([
    "--api-key", "test-key", "email", "drafts", "create", "-i", "writer",
    "--forward-note-text", "FYI",
  ]);
  assert.ok(missingSource.error);
  assert.match(missingSource.stderr, /Forward options require --forward-message-id/);

  const replyFields = await runCli([
    "--api-key", "test-key", "email", "drafts", "create", "-i", "writer",
    "--forward-message-id", "source-1", "--body-text", "wrong field",
  ]);
  assert.ok(replyFields.error);
  assert.match(replyFields.stderr, /Forward drafts use forward notes/);

  const inlineWithoutHtml = await runCli([
    "--api-key", "test-key", "email", "drafts", "create", "-i", "writer",
    "--inline-image", "pixel=image.png",
  ]);
  assert.ok(inlineWithoutHtml.error);
  assert.match(inlineWithoutHtml.stderr, /--inline-image requires --body-html/);
});

test("JSON API errors preserve structured detail and retry metadata on stderr", async () => {
  await withMock(async (_req, res) => {
    res.writeHead(409, {
      "Content-Type": "application/json",
      "Retry-After": "12",
    });
    res.end(JSON.stringify({
      detail: {
        error: "draft_generation_conflict",
        message: "The draft changed.",
        current_generation: 5,
      },
    }));
  }, async (baseUrl) => {
    const result = await runCli(args(
      baseUrl,
      "--json", "email", "drafts", "get", draftId, "-i", "writer",
    ));
    assert.ok(result.error);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      error: {
        type: "InkboxAPIError",
        message: "draft_generation_conflict: The draft changed.",
        statusCode: 409,
        detail: {
          error: "draft_generation_conflict",
          message: "The draft changed.",
          current_generation: 5,
        },
        retryAfterSeconds: 12,
        agentSupport: null,
      },
    });
  });
});

test("list prints requested human columns and full JSON summaries", async () => {
  await withMock(async (_req, res) => {
    json(res, { items: [summary], next_cursor: null, has_more: false });
  }, async (baseUrl) => {
    const table = await runCli(args(baseUrl, "email", "drafts", "list", "-i", "writer", "--limit", "1"));
    assert.ifError(table.error);
    for (const heading of ["id", "to", "subject", "attachments", "generation", "updatedAt"]) {
      assert.match(table.stdout, new RegExp(`\\b${heading}\\b`));
    }
    assert.match(table.stdout, /one@example\.com, two@example\.com/);

    const jsonResult = await runCli(args(baseUrl, "--json", "email", "drafts", "list", "-i", "writer"));
    assert.ifError(jsonResult.error);
    const parsed = JSON.parse(jsonResult.stdout)[0];
    assert.equal(parsed.mailboxId, identity.mailbox.id);
    assert.equal(parsed.snippet, "Draft body");
    assert.equal(parsed.sendState, "draft");
    assert.equal(parsed.attachmentCount, 2);
  });
});

test("list caps page size while honoring a larger total limit", async () => {
  const urls = [];
  let page = 0;
  await withMock(async (req, res) => {
    urls.push(req.url);
    page += 1;
    if (page === 1) {
      json(res, {
        items: Array.from({ length: 100 }, (_, index) => ({
          ...summary,
          id: `draft-${index}`,
        })),
        next_cursor: "next-page",
        has_more: true,
      });
      return;
    }
    json(res, {
      items: [{ ...summary, id: "draft-100" }],
      next_cursor: null,
      has_more: false,
    });
  }, async (baseUrl) => {
    const result = await runCli(args(
      baseUrl,
      "--json", "email", "drafts", "list", "-i", "writer", "--limit", "101",
    ));
    assert.ifError(result.error);
    assert.equal(JSON.parse(result.stdout).length, 101);
  });

  assert.match(urls[0], /[?&]limit=100(?:&|$)/);
  assert.match(urls[1], /[?&]limit=100(?:&|$)/);
  assert.match(urls[1], /[?&]cursor=next-page(?:&|$)/);
});

test("get, duplicate, send, and delete use their SDK-owned generation placement", async () => {
  const requests = [];
  await withMock(async (req, res) => {
    requests.push({ method: req.method, url: req.url, body: await requestBody(req) });
    if (req.url.endsWith("/send")) json(res, message);
    else if (req.method === "DELETE") { res.writeHead(204); res.end(); }
    else json(res, detail);
  }, async (baseUrl) => {
    for (const command of [
      ["get", draftId],
      ["duplicate", draftId, "--generation", "4"],
      ["send", draftId, "--generation", "4"],
      ["delete", draftId, "--generation", "4"],
    ]) {
      const result = await runCli(args(baseUrl, "--json", "email", "drafts", ...command, "-i", "writer"));
      assert.ifError(result.error);
      if (command[0] === "send") {
        assert.deepEqual(JSON.parse(result.stdout), {
          id: message.id,
          subject: message.subject,
          to: "one@example.com",
          status: "queued",
        });
      } else if (command[0] === "delete") {
        assert.deepEqual(JSON.parse(result.stdout), {
          deleted: true,
          id: draftId,
          generation: 4,
        });
      }
    }
  });
  assert.deepEqual(requests, [
    { method: "GET", url: `/api/v1/mail/mailboxes/${email}/drafts/${draftId}`, body: undefined },
    { method: "POST", url: `/api/v1/mail/mailboxes/${email}/drafts/${draftId}/duplicate`, body: { generation: 4 } },
    { method: "POST", url: `/api/v1/mail/mailboxes/${email}/drafts/${draftId}/send`, body: { generation: 4 } },
    { method: "DELETE", url: `/api/v1/mail/mailboxes/${email}/drafts/${draftId}?generation=4`, body: undefined },
  ]);
});

test("attachment add and remove validate inputs and serialize requests", async () => {
  const noFile = await runCli([
    "--api-key", "test-key", "email", "drafts", "attachment", "add", draftId,
    "-i", "writer", "--generation", "4",
  ]);
  assert.ok(noFile.error);
  assert.match(noFile.stderr, /Pass at least one --attach path/);

  const dir = mkdtempSync(join(tmpdir(), "inkbox-draft-attachment-"));
  const path = join(dir, "data.bin");
  writeFileSync(path, Buffer.from([9, 8, 7]));
  const requests = [];
  await withMock(async (req, res) => {
    requests.push({ method: req.method, url: req.url, body: await requestBody(req) });
    json(res, detail);
  }, async (baseUrl) => {
    const added = await runCli(args(
      baseUrl, "--json", "email", "drafts", "attachment", "add", draftId,
      "-i", "writer", "--generation", "4", "--attach", path,
    ));
    assert.ifError(added.error);
    const removed = await runCli(args(
      baseUrl, "--json", "email", "drafts", "attachment", "remove", draftId, "2",
      "-i", "writer", "--generation", "5",
    ));
    assert.ifError(removed.error);
  });
  assert.deepEqual(requests, [
    {
      method: "POST",
      url: `/api/v1/mail/mailboxes/${email}/drafts/${draftId}/attachments`,
      body: {
        generation: 4,
        attachments: [{
          filename: "data.bin",
          content_type: "application/octet-stream",
          content_base64: "CQgH",
        }],
      },
    },
    {
      method: "DELETE",
      url: `/api/v1/mail/mailboxes/${email}/drafts/${draftId}/attachments/2?generation=5`,
      body: undefined,
    },
  ]);
});

test("attachment download writes exact bytes only to the explicit output path", async () => {
  const bytes = Buffer.from([0, 255, 1, 2, 128, 10]);
  const dir = mkdtempSync(join(tmpdir(), "inkbox-draft-download-"));
  const destination = join(dir, "download.bin");
  let request;
  await withMock(async (req, res) => {
    request = { method: req.method, url: req.url };
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment; filename=source.bin",
    });
    res.end(bytes);
  }, async (baseUrl) => {
    const result = await runCli(args(
      baseUrl,
      "--json", "email", "drafts", "attachment", "download", draftId, "2",
      "-i", "writer", "--generation", "4", "--output", destination,
    ));
    assert.ifError(result.error);
    assert.deepEqual(readFileSync(destination), bytes);
    assert.deepEqual(JSON.parse(result.stdout), {
      output: destination,
      filename: "source.bin",
      contentType: "application/octet-stream",
      size: bytes.length,
    });
    assert.equal(Buffer.from(result.stdout).includes(bytes), false);
  });
  assert.deepEqual(request, {
    method: "GET",
    url: `/api/v1/mail/mailboxes/${email}/drafts/${draftId}/attachments/2?generation=4`,
  });
});
