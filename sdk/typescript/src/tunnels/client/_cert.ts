/**
 * inkbox-tunnels/client/_cert.ts
 *
 * Passthrough cert lifecycle: load-or-create EC P-256 keypair, build
 * CSR, detect when the cached cert needs resigning. Mirrors Python
 * `_cert.py` exactly so on-disk state interops between the two SDKs.
 *
 * IMPORTANT: This module statically imports `@peculiar/x509` at the
 * top. The lazy-load boundary lives at the **call site** in
 * `_runtime.ts` (or `index.ts`) so the edge-mode bundle never pulls
 * `_cert.ts` into the module graph at all. See M5's bundle-size
 * verification.
 */

// peculiar/x509 internally uses tsyringe, which needs the
// reflect-metadata polyfill to be loaded BEFORE the library imports.
// Keep this side-effect import first so the lazy-load boundary in
// _runtime.ts/index.ts pulls everything in correctly.
import "reflect-metadata";

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as x509 from "@peculiar/x509";

import {
  CERT_FILE,
  KEY_FILE,
  ensurePrivateStateDir,
  writePrivateFile,
} from "./_state.js";

const RENEWAL_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;

// peculiar/x509 reads the global cryptoProvider when its routines need
// crypto primitives. Wire Node's webcrypto in once at module load.
x509.cryptoProvider.set(crypto.webcrypto as unknown as Crypto);

// Cast Node's webcrypto subtle to the DOM types used by peculiar/x509
// and our function signatures. The runtime APIs are identical; the
// type definitions diverge between `lib.dom.d.ts` and Node's own.
const subtle = crypto.webcrypto.subtle as unknown as SubtleCrypto;

export interface KeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  /** PKCS8 PEM of the private key. */
  privatePem: string;
}

const ALGORITHM = {
  name: "ECDSA",
  namedCurve: "P-256",
} as const;

/**
 * Load EC P-256 key from disk or generate one. Returns the parsed
 * keypair. The on-disk format is PKCS8 PEM, matching Python.
 */
export async function loadOrCreateKeypair(stateDir: string): Promise<KeyPair> {
  const keyPath = path.join(stateDir, KEY_FILE);
  if (fs.existsSync(keyPath) && fs.statSync(keyPath).isFile()) {
    const pem = fs.readFileSync(keyPath, "utf-8");
    return await importPkcs8Pem(pem);
  }
  ensurePrivateStateDir(stateDir);
  const generated = (await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = await subtle.exportKey("pkcs8", generated.privateKey);
  const pem = pkcs8ToPem(Buffer.from(pkcs8));
  writePrivateFile(keyPath, pem);
  return {
    privateKey: generated.privateKey,
    publicKey: generated.publicKey,
    privatePem: pem,
  };
}

/**
 * Build a CSR with CN + SAN = `publicHost`. Signed with SHA-256.
 */
export async function buildCsr(
  key: KeyPair,
  publicHost: string,
): Promise<string> {
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: `CN=${publicHost}`,
    keys: { privateKey: key.privateKey, publicKey: key.publicKey },
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    extensions: [
      new x509.SubjectAlternativeNameExtension([
        { type: "dns", value: publicHost },
      ]),
    ],
  });
  return csr.toString("pem");
}

/** Return the cert's expiry (UTC) or null if missing/invalid. */
export function certExpiry(stateDir: string): Date | null {
  const certPath = path.join(stateDir, CERT_FILE);
  if (!fs.existsSync(certPath)) return null;
  let pem: string;
  try {
    pem = fs.readFileSync(certPath, "utf-8");
  } catch {
    return null;
  }
  // Read the leaf cert (first PEM block).
  const leafBlock = extractFirstPemBlock(pem, "CERTIFICATE");
  if (leafBlock === null) return null;
  try {
    const cert = new x509.X509Certificate(leafBlock);
    return cert.notAfter;
  } catch {
    return null;
  }
}

/**
 * Decide whether the cached cert needs resigning.
 *
 * - Missing cert / unreadable cert => resign.
 * - Within the 14-day renewal window => resign.
 * - Cert pubkey doesn't match the on-disk key (key regenerated since
 *   last signing) => resign.
 */
export async function certNeedsSign(
  stateDir: string,
  key: KeyPair,
): Promise<boolean> {
  const certPath = path.join(stateDir, CERT_FILE);
  const expiry = certExpiry(stateDir);
  if (!fs.existsSync(certPath) || expiry === null) return true;
  const now = new Date();
  if (expiry.getTime() - now.getTime() < RENEWAL_THRESHOLD_MS) return true;
  try {
    const pem = fs.readFileSync(certPath, "utf-8");
    const leafBlock = extractFirstPemBlock(pem, "CERTIFICATE");
    if (leafBlock === null) return true;
    const cert = new x509.X509Certificate(leafBlock);
    const certPubKey = (await cert.publicKey.export(
      crypto.webcrypto as unknown as Crypto,
    )) as CryptoKey;
    const certPubSpki = await subtle.exportKey("spki", certPubKey);
    const keyPubSpki = await subtle.exportKey("spki", key.publicKey);
    if (Buffer.compare(Buffer.from(certPubSpki), Buffer.from(keyPubSpki)) !== 0) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** Persist the signed cert+chain (mode 0o600); return the bytes. */
export function writeCertChain(
  stateDir: string,
  certPem: string,
  chainPem: string,
): Buffer {
  // PEM cross-language interop policy: leaf first, then intermediates,
  // \n line endings, trailing single \n. Mirror Python `_cert.py`.
  const fullChain = ensureSinglePemTerminator(certPem) + ensureSinglePemTerminator(chainPem);
  const certPath = path.join(stateDir, CERT_FILE);
  writePrivateFile(certPath, fullChain);
  return Buffer.from(fullChain, "ascii");
}

/** Serialize a private key as unencrypted PKCS8 PEM bytes. */
export async function keyPemBytes(key: KeyPair): Promise<Buffer> {
  return Buffer.from(key.privatePem, "ascii");
}

// --- internals -----------------------------------------------------------

async function importPkcs8Pem(pem: string): Promise<KeyPair> {
  const block = extractFirstPemBlock(pem, "PRIVATE KEY");
  if (block === null) {
    throw new Error("private_key.pem: missing PRIVATE KEY block");
  }
  const der = pemBlockToDer(block);
  // Cast to BufferSource's Uint8Array variant — Node's Buffer is
  // assignable but lib.dom.d.ts disagrees on ArrayBufferLike vs
  // ArrayBuffer.
  const privateKey = await subtle.importKey(
    "pkcs8",
    new Uint8Array(der),
    ALGORITHM,
    true,
    ["sign"],
  );
  // Derive the public key from the private — JOSE jwk round-trip.
  const jwk = await subtle.exportKey("jwk", privateKey);
  const pubJwk: JsonWebKey = { ...jwk };
  delete pubJwk.d;
  pubJwk.key_ops = ["verify"];
  const publicKey = await subtle.importKey(
    "jwk",
    pubJwk,
    ALGORITHM,
    true,
    ["verify"],
  );
  return { privateKey, publicKey, privatePem: pem };
}

function pkcs8ToPem(der: Buffer): string {
  const b64 = der.toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

function extractFirstPemBlock(pem: string, label: string): string | null {
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const beginIdx = pem.indexOf(begin);
  const endIdx = pem.indexOf(end);
  if (beginIdx < 0 || endIdx < 0 || endIdx < beginIdx) return null;
  return pem.slice(beginIdx, endIdx + end.length);
}

function pemBlockToDer(block: string): Buffer {
  const lines = block.split(/\r?\n/).filter(
    (l) => l.length > 0 && !l.startsWith("-----"),
  );
  return Buffer.from(lines.join(""), "base64");
}

function ensureSinglePemTerminator(pem: string): string {
  // Strip Windows line endings, trailing whitespace, and excess
  // newlines; ensure a single \n after the final -----END...-----.
  let out = pem.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n");
  while (out.endsWith("\n\n")) out = out.slice(0, -1);
  if (!out.endsWith("\n")) out += "\n";
  return out;
}

