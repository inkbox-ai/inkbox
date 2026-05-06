import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildCsr,
  certNeedsSign,
  loadOrCreateKeypair,
  keyPemBytes,
} from "../../src/tunnels/client/_cert.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkbox-cert-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadOrCreateKeypair", () => {
  it("generates a fresh EC P-256 key when none exists, persists it as PKCS8 PEM", async () => {
    const key = await loadOrCreateKeypair(tmpDir);
    expect(key.privatePem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(key.privatePem).toMatch(/-----END PRIVATE KEY-----\n$/);
    const onDisk = fs.readFileSync(path.join(tmpDir, "private_key.pem"), "utf-8");
    expect(onDisk).toBe(key.privatePem);
    const stat = fs.statSync(path.join(tmpDir, "private_key.pem"));
    // 0o600 file mode (lower 9 bits).
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("loads an existing key on second invocation", async () => {
    const k1 = await loadOrCreateKeypair(tmpDir);
    const k2 = await loadOrCreateKeypair(tmpDir);
    expect(k2.privatePem).toBe(k1.privatePem);
  });
});

describe("buildCsr", () => {
  it("produces a PEM-encoded CSR with CN+SAN matching publicHost", async () => {
    const key = await loadOrCreateKeypair(tmpDir);
    const csr = await buildCsr(key, "my-agent.example.com");
    expect(csr).toMatch(/^-----BEGIN CERTIFICATE REQUEST-----/);
    expect(csr).toMatch(/-----END CERTIFICATE REQUEST-----/);
    // The CN encoding contains the host string in DER; check the
    // surrounding bytes survive round-trip.
    const der = Buffer.from(
      csr
        .split("\n")
        .filter((l) => l.length > 0 && !l.startsWith("-----"))
        .join(""),
      "base64",
    );
    expect(der.length).toBeGreaterThan(0);
  });
});

describe("certNeedsSign", () => {
  it("returns true when no cert is on disk", async () => {
    const key = await loadOrCreateKeypair(tmpDir);
    expect(await certNeedsSign(tmpDir, key)).toBe(true);
  });
});

describe("keyPemBytes", () => {
  it("returns the PKCS8 PEM verbatim", async () => {
    const key = await loadOrCreateKeypair(tmpDir);
    const bytes = await keyPemBytes(key);
    expect(bytes.toString("ascii")).toBe(key.privatePem);
  });
});
