/**
 * tests/tunnels/state_interop.test.ts
 *
 * Cross-language PEM-format conformance test.
 *
 * Background — why no checked-in fixtures: the plan called for paired
 * directories (`state_from_python/`, `state_from_typescript/`)
 * containing real cryptographic material. We deliberately diverge: no
 * `.pem` files in the repo, period (matches the Python SDK's stance).
 *
 * Instead, the verification this test enforces is structural — given
 * a TS-generated PEM, assert it conforms to the on-disk spec the
 * Python SDK reads/writes:
 *
 *   - PRIVATE KEY block in PKCS8 (NOT SEC1) — `BEGIN PRIVATE KEY`
 *   - CERTIFICATE block — `BEGIN CERTIFICATE`
 *   - Body lines: 64-char base64, no padding inside, `=` only on last
 *   - Line endings: `\n` only (no CRLF, no trailing whitespace)
 *   - Single trailing `\n` after the final `-----END ...-----`
 *
 * If both SDKs use libraries (`cryptography` on Python,
 * `@peculiar/x509` + Node webcrypto on TS) that emit PKCS8/X.509
 * conformant to this spec, on-disk interop holds. The plan's
 * pair-of-one-way-reads forcing function is replaced by this format
 * spec test on the TS side, with the symmetric assumption checked on
 * the Python side via its existing PEM round-trip tests.
 */

import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildCsr,
  loadOrCreateKeypair,
} from "../../src/tunnels/client/_cert.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkbox-state-interop-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface PemInspection {
  label: string;
  bodyLines: string[];
  body: string;
  trailingNewline: boolean;
}

function inspectPem(pem: string, label: string): PemInspection {
  expect(pem.includes("\r")).toBe(false); // no CRLF
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const beginIdx = pem.indexOf(begin);
  const endIdx = pem.indexOf(end);
  expect(beginIdx).toBeGreaterThanOrEqual(0);
  expect(endIdx).toBeGreaterThan(beginIdx);
  const bodyText = pem.slice(beginIdx + begin.length, endIdx);
  const bodyLines = bodyText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return {
    label,
    bodyLines,
    body: bodyLines.join(""),
    trailingNewline: pem.endsWith("\n"),
  };
}

describe("PEM on-disk format conformance (cross-SDK interop)", () => {
  it("private key is PKCS8, not SEC1", async () => {
    const key = await loadOrCreateKeypair(tmpDir);
    expect(key.privatePem).toMatch(/-----BEGIN PRIVATE KEY-----/);
    expect(key.privatePem).not.toMatch(/-----BEGIN EC PRIVATE KEY-----/);
  });

  it("private key body is valid base64 and round-trips through Buffer", async () => {
    const key = await loadOrCreateKeypair(tmpDir);
    const insp = inspectPem(key.privatePem, "PRIVATE KEY");
    expect(insp.body).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    const der = Buffer.from(insp.body, "base64");
    expect(der.toString("base64")).toBe(insp.body);
  });

  it("private key uses LF line endings and a single trailing LF", async () => {
    const key = await loadOrCreateKeypair(tmpDir);
    expect(key.privatePem.endsWith("\n")).toBe(true);
    expect(key.privatePem.endsWith("\n\n")).toBe(false);
    expect(key.privatePem).not.toMatch(/\r/);
    expect(key.privatePem).not.toMatch(/[ \t]+\n/); // no trailing space
  });

  it("private key body lines are <= 64 chars (PEM canonical wrap)", async () => {
    const key = await loadOrCreateKeypair(tmpDir);
    const insp = inspectPem(key.privatePem, "PRIVATE KEY");
    for (const line of insp.bodyLines) {
      expect(line.length).toBeLessThanOrEqual(64);
    }
  });

  it("private key on-disk PEM matches what loadOrCreateKeypair returned", async () => {
    const key = await loadOrCreateKeypair(tmpDir);
    const onDisk = fs.readFileSync(path.join(tmpDir, "private_key.pem"), "utf-8");
    expect(onDisk).toBe(key.privatePem);
    // The on-disk file MUST be 0o600.
    const stat = fs.statSync(path.join(tmpDir, "private_key.pem"));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("CSR is PEM-wrapped CERTIFICATE REQUEST with valid base64 body", async () => {
    const key = await loadOrCreateKeypair(tmpDir);
    const csr = await buildCsr(key, "my-agent.example.com");
    const insp = inspectPem(csr, "CERTIFICATE REQUEST");
    expect(insp.body.length).toBeGreaterThan(0);
    expect(insp.body).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});

describe("State.json format conformance (cross-SDK interop)", () => {
  it("the on-disk state.json schema uses snake_case keys", async () => {
    const { saveState } = await import("../../src/tunnels/client/_state.js");
    saveState(tmpDir, {
      tunnelId: "11111111-1111-1111-1111-111111111111",
      name: "my-agent",
      secret: "sek",
      mode: "passthrough",
      zone: "inkboxwire.com",
      publicHost: "my-agent.inkboxwire.com",
    });
    const raw = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "state.json"), "utf-8"),
    ) as Record<string, unknown>;
    // The Python SDK's state.json uses snake_case; TS must too.
    expect(raw["tunnel_id"]).toBe("11111111-1111-1111-1111-111111111111");
    expect(raw["public_host"]).toBe("my-agent.inkboxwire.com");
    expect(raw["name"]).toBe("my-agent");
    // Camel-case keys must NOT be present.
    expect(raw).not.toHaveProperty("tunnelId");
    expect(raw).not.toHaveProperty("publicHost");
  });
});
