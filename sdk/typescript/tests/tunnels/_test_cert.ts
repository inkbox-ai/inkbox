/**
 * tests/tunnels/_test_cert.ts
 *
 * Generate a throwaway self-signed EC P-256 cert for the fake h2 test
 * server. Generated once per test process and cached in memory; never
 * touches disk.
 *
 * The certificate's CN is `inkbox-test.invalid` — the `.invalid` TLD is
 * IANA-reserved and resolves nowhere, so the cert cannot impersonate a
 * real host. The matching production code path uses CA-signed EC P-256
 * certs.
 */

import "reflect-metadata";
import * as crypto from "node:crypto";
import * as x509 from "@peculiar/x509";

x509.cryptoProvider.set(crypto.webcrypto as unknown as Crypto);
const subtle = crypto.webcrypto.subtle as unknown as SubtleCrypto;

interface Materials {
  cert: Buffer;
  key: Buffer;
}

let cached: Promise<Materials> | null = null;

export function generateSelfSignedCert(): Promise<Materials> {
  if (cached === null) cached = generate();
  return cached;
}

async function generate(): Promise<Materials> {
  const keys = (await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const cn = "inkbox-test.invalid";
  const notBefore = new Date(Date.now() - 60_000);
  const notAfter = new Date(notBefore.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);

  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: `CN=${cn}`,
    notBefore,
    notAfter,
    keys,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    extensions: [
      new x509.SubjectAlternativeNameExtension([
        { type: "dns", value: cn },
        { type: "ip", value: "127.0.0.1" },
      ]),
    ],
  });

  const pkcs8 = await subtle.exportKey("pkcs8", keys.privateKey);
  return {
    cert: Buffer.from(cert.toString("pem"), "ascii"),
    key: Buffer.from(pkcs8ToPem(Buffer.from(pkcs8)), "ascii"),
  };
}

function pkcs8ToPem(der: Buffer): string {
  const b64 = der.toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}
