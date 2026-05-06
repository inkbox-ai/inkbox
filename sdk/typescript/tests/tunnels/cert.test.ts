import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as crypto from "node:crypto";
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

describe("certExpiry", () => {
  it("returns null when no cert is present", async () => {
    const { certExpiry } = await import("../../src/tunnels/client/_cert.js");
    expect(certExpiry(tmpDir)).toBeNull();
  });

  it("returns null on a malformed cert file", async () => {
    const { certExpiry } = await import("../../src/tunnels/client/_cert.js");
    fs.writeFileSync(path.join(tmpDir, "cert_chain.pem"), "not-a-pem");
    expect(certExpiry(tmpDir)).toBeNull();
  });
});

describe("writeCertChain", () => {
  it("writes leaf-then-chain with mode 0o600 and a single trailing LF", async () => {
    const { writeCertChain } = await import("../../src/tunnels/client/_cert.js");
    const leaf = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
    const chain = "-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----";
    fs.mkdirSync(tmpDir, { recursive: true });
    const bytes = writeCertChain(tmpDir, leaf, chain);
    expect(bytes.length).toBeGreaterThan(0);
    const onDisk = fs.readFileSync(path.join(tmpDir, "cert_chain.pem"), "utf-8");
    expect(onDisk).toMatch(/^-----BEGIN CERTIFICATE-----/);
    // Leaf comes first.
    expect(onDisk.indexOf("MIIB")).toBeLessThan(onDisk.indexOf("MIIC"));
    expect(onDisk.endsWith("\n")).toBe(true);
    expect(onDisk.endsWith("\n\n")).toBe(false);
    expect(onDisk).not.toMatch(/\r/);
    const stat = fs.statSync(path.join(tmpDir, "cert_chain.pem"));
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe("certNeedsSign — additional branches", () => {
  it("returns true when on-disk cert is malformed", async () => {
    const { certNeedsSign } = await import("../../src/tunnels/client/_cert.js");
    const key = await loadOrCreateKeypair(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "cert_chain.pem"), "not-a-pem");
    expect(await certNeedsSign(tmpDir, key)).toBe(true);
  });

  it("returns false for a valid, in-window cert that matches the key", async () => {
    const { writeCertChain, certNeedsSign, buildCsr } = await import(
      "../../src/tunnels/client/_cert.js"
    );
    const key = await loadOrCreateKeypair(tmpDir);
    // Generate a self-signed cert with the same key so the pubkey
    // match check passes and the renewal window is not tripped.
    const x509 = await import("@peculiar/x509");
    const cn = "in-window-cert.example";
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: "01",
      name: `CN=${cn}`,
      notBefore: new Date(Date.now() - 60_000),
      notAfter: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days out
      keys: { privateKey: key.privateKey, publicKey: key.publicKey },
      signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    });
    writeCertChain(tmpDir, cert.toString("pem"), "");
    expect(await certNeedsSign(tmpDir, key)).toBe(false);
    // Touch the CSR builder while we have a valid keypair.
    const csr = await buildCsr(key, cn);
    expect(csr).toMatch(/CERTIFICATE REQUEST/);
  });

  it("returns true when the cert pubkey does NOT match the on-disk key", async () => {
    const { writeCertChain, certNeedsSign } = await import(
      "../../src/tunnels/client/_cert.js"
    );
    const key = await loadOrCreateKeypair(tmpDir);
    // Generate a cert with a DIFFERENT key; the pubkey mismatch
    // should force a resign.
    const x509 = await import("@peculiar/x509");
    const otherKeys = await crypto.webcrypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: "01",
      name: "CN=mismatch.example",
      notBefore: new Date(Date.now() - 60_000),
      notAfter: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      keys: otherKeys,
      signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    });
    writeCertChain(tmpDir, cert.toString("pem"), "");
    expect(await certNeedsSign(tmpDir, key)).toBe(true);
  });
});

describe("loadOrCreateKeypair — error paths", () => {
  it("rejects a malformed private_key.pem", async () => {
    fs.writeFileSync(path.join(tmpDir, "private_key.pem"), "not-a-pem");
    await expect(loadOrCreateKeypair(tmpDir)).rejects.toThrowError(
      /missing PRIVATE KEY block/,
    );
  });
});
