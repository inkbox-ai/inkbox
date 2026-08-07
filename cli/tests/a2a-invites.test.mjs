import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolveOptionalA2AInvitationToken } from "../dist/invitation-token.js";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const execFileAsync = promisify(execFile);
const invitationToken = (character) => `a2ai_${character.repeat(43)}`;

function help(...args) {
  return execFileSync(process.execPath, [cli, ...args, "--help"], { encoding: "utf8" });
}

test("A2A invitation CLI exposes only the frozen command set", () => {
  const commands = help("a2a", "invites");
  for (const command of ["create", "list", "show", "revoke", "accept"]) {
    assert.match(commands, new RegExp(command));
  }
  assert.doesNotMatch(commands, /decline|resend/);
  const accept = help("a2a", "invites", "accept");
  assert.match(accept, /--invitation-stdin/);
  assert.match(accept, /--token-stdin/);
  assert.doesNotMatch(accept, /--invitation-token|--token </);
});

test("signup accepts invitation secrets only through safe input sources", () => {
  const signup = help("signup", "create");
  assert.match(signup, /--invitation-stdin/);
  assert.match(signup, /--invitation-prompt/);
  assert.match(signup, /--invitation-token-stdin/);
  assert.match(signup, /--invitation-token-prompt/);
  assert.doesNotMatch(signup, /--invitation-token <|--invitation-token \[/);
});

test("ordinary signup does not prompt while the explicit prompt source does", async () => {
  const previousNeutral = process.env.INKBOX_A2A_INVITATION;
  const previous = process.env.INKBOX_A2A_INVITATION_TOKEN;
  delete process.env.INKBOX_A2A_INVITATION;
  delete process.env.INKBOX_A2A_INVITATION_TOKEN;
  let promptCalls = 0;
  const prompt = async () => {
    promptCalls += 1;
    return invitationToken("P");
  };
  try {
    assert.equal(
      await resolveOptionalA2AInvitationToken(false, false, prompt),
      undefined,
    );
    assert.equal(promptCalls, 0);
    assert.equal(
      await resolveOptionalA2AInvitationToken(false, true, prompt),
      invitationToken("P"),
    );
    assert.equal(promptCalls, 1);
    await assert.rejects(
      resolveOptionalA2AInvitationToken(true, true, prompt),
      /Use only one/,
    );
  } finally {
    if (previousNeutral === undefined) delete process.env.INKBOX_A2A_INVITATION;
    else process.env.INKBOX_A2A_INVITATION = previousNeutral;
    if (previous === undefined) delete process.env.INKBOX_A2A_INVITATION_TOKEN;
    else process.env.INKBOX_A2A_INVITATION_TOKEN = previous;
  }
});

test("signup extracts a neutral-environment invitation URL without printing it", async (t) => {
  let submitted;
  const baseUrl = await withServer(t, async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    submitted = { url: request.url, body: JSON.parse(body) };
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      api_key: "ApiKey_once",
      identity_id: "identity_2",
      agent_handle: "buyer",
      email_address: "buyer@example.test",
      organization_id: "org_2",
      claim_status: "agent_unclaimed",
      human_email: "person@example.test",
      message: "Check your email.",
      invitation: {
        invitation_id: "inv_1",
        status: "awaiting_verification",
        invitee_identity_id: "identity_2",
        invitee_agent_handle: "buyer",
        peer_agent_handles: ["support"],
        accepted_at: null,
      },
    }));
  });
  const secret = invitationToken("S");
  const invitationUrl = `${baseUrl}/console/a2a/invitations/accept#token=${secret}`;
  const result = await execFileAsync(process.execPath, [
    cli,
    "--json",
    "--base-url",
    baseUrl,
    "signup",
    "create",
    "--human-email",
    "person@example.test",
    "--note-to-human",
    "Please verify this agent.",
  ], {
    env: {
      ...process.env,
      INKBOX_A2A_INVITATION: invitationUrl,
      INKBOX_A2A_INVITATION_TOKEN: "",
      NODE_USE_ENV_PROXY: "0",
    },
  });
  assert.equal(submitted.url, "/api/v1/agent-signup");
  assert.equal(submitted.body.invitation_token, secret);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("signup prints the authoritative auto-accept result without claiming an email was sent", async (t) => {
  const baseUrl = await withServer(t, (_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      api_key: "ApiKey_auto_accepted_once",
      identity_id: "identity_2",
      agent_handle: "buyer",
      email_address: "buyer@example.test",
      organization_id: "org_2",
      claim_status: "agent_claimed",
      human_email: "person@example.test",
      message: "Agent registered, claimed, and connected through the A2A invitation.",
      invitation: {
        invitation_id: "inv_1",
        status: "accepted",
        invitee_identity_id: "identity_2",
        invitee_agent_handle: "buyer",
        peer_agent_handles: ["support"],
        accepted_at: "2026-08-04T01:00:00Z",
      },
    }));
  });
  const result = await execFileAsync(process.execPath, [
    cli,
    "--base-url",
    baseUrl,
    "signup",
    "create",
    "--human-email",
    "person@example.test",
    "--note-to-human",
    "Connect this agent.",
  ], {
    env: {
      ...process.env,
      INKBOX_A2A_INVITATION_TOKEN: invitationToken("A"),
      NODE_USE_ENV_PROXY: "0",
    },
  });
  assert.match(result.stdout, /ApiKey_auto_accepted_once/);
  assert.match(
    result.stdout,
    /Agent registered, claimed, and connected through the A2A invitation\./,
  );
  assert.doesNotMatch(result.stdout + result.stderr, /verification email has been sent/i);
  assert.equal(result.stderr, "");
});

test("signup prints the authoritative verification delivery failure", async (t) => {
  const serverMessage =
    "Agent registered but the verification email could not be sent. " +
    "Use `/agent-signup/resend-verification` to retry.";
  const baseUrl = await withServer(t, (_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      api_key: "ApiKey_delivery_failed_once",
      identity_id: "identity_2",
      agent_handle: "buyer",
      email_address: "buyer@example.test",
      organization_id: "org_2",
      claim_status: "agent_unclaimed",
      human_email: "person@example.test",
      message: serverMessage,
      invitation: {
        invitation_id: "inv_1",
        status: "awaiting_verification",
        invitee_identity_id: "identity_2",
        invitee_agent_handle: "buyer",
        peer_agent_handles: ["support"],
        accepted_at: null,
      },
    }));
  });
  const result = await execFileAsync(process.execPath, [
    cli,
    "--base-url",
    baseUrl,
    "signup",
    "create",
    "--human-email",
    "person@example.test",
    "--note-to-human",
    "Connect this agent.",
  ], {
    env: {
      ...process.env,
      INKBOX_A2A_INVITATION_TOKEN: invitationToken("D"),
      NODE_USE_ENV_PROXY: "0",
    },
  });
  assert.match(result.stdout, /ApiKey_delivery_failed_once/);
  assert.match(result.stdout, new RegExp(serverMessage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(result.stdout + result.stderr, /verification email has been sent/i);
  assert.equal(result.stderr, "");
});

test("signup warns when a server does not confirm the supplied invitation", async (t) => {
  const secret = invitationToken("U");
  const baseUrl = await withServer(t, (_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      api_key: "ApiKey_unconfirmed_once",
      identity_id: "identity_2",
      agent_handle: "buyer",
      email_address: "buyer@example.test",
      organization_id: "org_2",
      claim_status: "agent_unclaimed",
      human_email: "person@example.test",
      message: "Verification email sent to person@example.test.",
    }));
  });
  const result = await execFileAsync(process.execPath, [
    cli,
    "--base-url",
    baseUrl,
    "signup",
    "create",
    "--human-email",
    "person@example.test",
    "--note-to-human",
    "Connect this agent.",
  ], {
    env: {
      ...process.env,
      INKBOX_A2A_INVITATION_TOKEN: secret,
      NODE_USE_ENV_PROXY: "0",
    },
  });
  assert.match(result.stdout, /ApiKey_unconfirmed_once/);
  assert.match(result.stderr, /WARNING:.*did not confirm.*A2A invitation/i);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
});

async function withServer(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");
  return `http://127.0.0.1:${address.port}`;
}

function claimedWhoami() {
  return {
    auth_type: "api_key",
    auth_subtype: "api_key.agent_scoped.claimed",
    scope: "agent_identity:identity_2",
    organization_id: "org_2",
    created_by: null,
    creator_type: null,
    key_id: null,
    label: null,
    description: null,
    created_at: null,
    last_used_at: null,
    expires_at: null,
  };
}

const managementInvitation = {
  id: "inv_1",
  issuer_organization_id: "org_1",
  inviter_email: "owner@example.com",
  peer_agent_handles: ["support", "billing"],
  recipient_email: null,
  status: "pending",
  email_status: "not_requested",
  email_sent_at: null,
  invitee_identity_id: null,
  invitee_agent_handle: null,
  invitee_organization_id: null,
  expires_at: "2026-08-11T00:00:00Z",
  accepted_at: null,
  declined_at: null,
  revoked_at: null,
  created_at: "2026-08-04T00:00:00Z",
  updated_at: "2026-08-04T00:00:00Z",
};

test("management commands use the create, list, show, and revoke routes", async (t) => {
  const requests = [];
  const baseUrl = await withServer(t, async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, body });
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url?.includes("?")) {
      response.end(JSON.stringify({ items: [managementInvitation], next_cursor: null }));
    } else if (request.url?.endsWith("/revoke")) {
      response.end(JSON.stringify({ ...managementInvitation, status: "revoked", revoked_at: "2026-08-04T01:00:00Z" }));
    } else if (request.method === "POST") {
      response.end(JSON.stringify({ ...managementInvitation, invitation_token: invitationToken("M"), agent_handoff_prompt: "handoff" }));
    } else {
      response.end(JSON.stringify(managementInvitation));
    }
  });
  const env = { ...process.env, INKBOX_API_KEY: "ApiKey_admin", INKBOX_BASE_URL: baseUrl, NODE_USE_ENV_PROXY: "0" };
  const run = (...args) => execFileAsync(process.execPath, [cli, "--json", "a2a", "invites", ...args], { env });

  await run("create", "--peer-agent-handle", "support", "billing", "--expires-in-seconds", "7200");
  await run("list", "--status", "pending", "--limit", "10");
  await run("show", "inv_1");
  await run("revoke", "inv_1");

  assert.deepEqual(JSON.parse(requests[0].body), {
    peer_agent_handles: ["support", "billing"],
    expires_in_seconds: 7200,
  });
  assert.match(requests[1].url, /status=pending/);
  assert.equal(requests[2].url, "/api/v1/a2a/invitations/inv_1");
  assert.equal(requests[3].url, "/api/v1/a2a/invitations/inv_1/revoke");
});

test("accept extracts a neutral-environment share URL and never prints either secret form", async (t) => {
  const requests = [];
  const baseUrl = await withServer(t, async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, body });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/whoami") response.end(JSON.stringify(claimedWhoami()));
    else response.end(JSON.stringify({
      invitation_id: "inv_1",
      status: "accepted",
      invitee_identity_id: "identity_2",
      invitee_agent_handle: "buyer",
      peer_agent_handles: ["support"],
      accepted_at: "2026-08-04T01:00:00Z",
    }));
  });
  const secret = invitationToken("T");
  const invitationUrl = `${baseUrl}/console/a2a/invitations/accept#token=${secret}`;
  const result = await execFileAsync(process.execPath, [cli, "--json", "a2a", "invites", "accept"], {
    env: { ...process.env, INKBOX_API_KEY: "ApiKey_agent", INKBOX_A2A_INVITATION: invitationUrl, INKBOX_A2A_INVITATION_TOKEN: "", INKBOX_BASE_URL: baseUrl, NODE_USE_ENV_PROXY: "0" },
  });
  assert.equal(requests[0].url, "/api/whoami");
  assert.equal(requests[1].url, "/api/v1/a2a/invitations/accept");
  assert.deepEqual(JSON.parse(requests[1].body), { invitation_token: secret });
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("accept rejects the legacy public invitation path before submitting the secret", async (t) => {
  const urls = [];
  const baseUrl = await withServer(t, (request, response) => {
    urls.push(request.url);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(claimedWhoami()));
  });
  const secret = invitationToken("O");
  const legacyUrl = `${baseUrl}/a2a/invitations/accept#token=${secret}`;
  await assert.rejects(execFileAsync(process.execPath, [cli, "a2a", "invites", "accept"], {
    env: { ...process.env, INKBOX_API_KEY: "ApiKey_agent", INKBOX_A2A_INVITATION: legacyUrl, INKBOX_A2A_INVITATION_TOKEN: "", INKBOX_BASE_URL: baseUrl, NODE_USE_ENV_PROXY: "0" },
  }), (error) => {
    assert.doesNotMatch(error.stderr, new RegExp(secret));
    assert.doesNotMatch(error.stderr, new RegExp(baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return true;
  });
  assert.deepEqual(urls, ["/api/whoami"]);
});

test("accept rejects admin auth before submitting the invitation token", async (t) => {
  const urls = [];
  const baseUrl = await withServer(t, (request, response) => {
    urls.push(request.url);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ...claimedWhoami(), auth_subtype: "api_key.admin_scoped", scope: "admin" }));
  });
  await assert.rejects(execFileAsync(process.execPath, [cli, "a2a", "invites", "accept"], {
    env: { ...process.env, INKBOX_API_KEY: "ApiKey_admin", INKBOX_A2A_INVITATION_TOKEN: invitationToken("T"), INKBOX_BASE_URL: baseUrl, NODE_USE_ENV_PROXY: "0" },
  }));
  assert.deepEqual(urls, ["/api/whoami"]);
});

test("accept redacts a reflected token from API errors", async (t) => {
  const secret = invitationToken("R");
  const baseUrl = await withServer(t, (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/whoami") {
      response.end(JSON.stringify(claimedWhoami()));
    } else {
      response.statusCode = 429;
      response.setHeader("Retry-After", "120");
      response.end(JSON.stringify({
        detail: {
          code: "a2a_invitation_attempt_rate_limited",
          message: `invalid ${secret}`,
        },
      }));
    }
  });
  await assert.rejects(
    execFileAsync(process.execPath, [cli, "a2a", "invites", "accept"], {
      env: { ...process.env, INKBOX_API_KEY: "ApiKey_agent", INKBOX_A2A_INVITATION_TOKEN: secret, INKBOX_BASE_URL: baseUrl, NODE_USE_ENV_PROXY: "0" },
    }),
    (error) => {
      assert.doesNotMatch(error.stdout + error.stderr, new RegExp(secret));
      assert.match(error.stderr, /\[REDACTED\]/);
      assert.match(error.stderr, /Retry in 120 seconds/);
      return true;
    },
  );
});

test("invitation environment aliases conflict without reflecting either capability", async (t) => {
  const baseUrl = await withServer(t, (_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(claimedWhoami()));
  });
  await assert.rejects(
    execFileAsync(process.execPath, [cli, "--base-url", baseUrl, "a2a", "invites", "accept"], {
      env: {
        ...process.env,
        INKBOX_API_KEY: "ApiKey_agent",
        INKBOX_A2A_INVITATION: invitationToken("N"),
        INKBOX_A2A_INVITATION_TOKEN: invitationToken("L"),
        NODE_USE_ENV_PROXY: "0",
      },
    }),
    (error) => {
      const output = error.stdout + error.stderr;
      assert.doesNotMatch(output, new RegExp(`${invitationToken("N")}|${invitationToken("L")}`));
      assert.match(output, /Set only one/);
      return true;
    },
  );
});
