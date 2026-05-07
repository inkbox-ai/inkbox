/**
 * inkbox-tunnels/client/_upstream_tls.ts
 *
 * TLS connection options for outbound upstream connections.
 *
 * When `forwardTo` is an `https://` URL, ``UpstreamUrlDispatch`` builds
 * an ``undici.Pool`` whose connect options carry these knobs:
 *
 * - ``forwardToVerifyTls`` — when ``false``, accept any cert. Used for
 *   local dev with self-signed certs on ``https://localhost``.
 * - ``forwardToCaBundle`` — extra PEM CA bundle to trust. Used for
 *   corporate dev environments with private CAs.
 *
 * The two are mutually exclusive in practice — passing a CA bundle while
 * disabling verification is meaningless.
 */

export interface UpstreamTlsConnectOpts {
  rejectUnauthorized?: boolean;
  ca?: Buffer | string;
}

export function buildUpstreamTlsConnectOpts(opts: {
  verify?: boolean;
  caBundle?: Buffer | string | null;
}): UpstreamTlsConnectOpts {
  const out: UpstreamTlsConnectOpts = {};
  out.rejectUnauthorized = opts.verify ?? true;
  if (opts.caBundle != null) out.ca = opts.caBundle;
  return out;
}
