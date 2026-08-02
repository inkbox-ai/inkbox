/**
 * Contract test: _protocol.ts must match the vendored manifest
 * `protocol/tunnel_protocol_constants.json` byte-for-byte by name and
 * value. Drift between the two is caught at PR time.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  INKBOX_FORWARDED_HEADER_PREFIX,
  INKBOX_NAMESPACE_PREFIX,
  ControlHeaders,
  ControlPaths,
  HOP_BY_HOP_REQUEST,
  HOP_BY_HOP_RESPONSE,
  TunnelMetaHeader,
  TunnelRouteKind,
  TunnelSubprotocol,
} from "../../src/tunnels/client/_protocol.js";

const manifestPath = path.join(
  __dirname,
  "..",
  "..",
  "protocol",
  "tunnel_protocol_constants.json",
);

interface Manifest {
  INKBOX_NAMESPACE_PREFIX: string;
  INKBOX_FORWARDED_HEADER_PREFIX: string;
  TunnelMetaHeader: Record<string, string>;
  TunnelRouteKind: Record<string, string>;
  TunnelSubprotocol: Record<string, string>;
  ControlPaths: Record<string, string>;
  ControlHeaders: Record<string, string>;
  HopByHopRequest: string[];
  HopByHopResponse: string[];
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Manifest;

describe("protocol_contract", () => {
  it("namespace prefixes match", () => {
    expect(INKBOX_NAMESPACE_PREFIX).toBe(manifest.INKBOX_NAMESPACE_PREFIX);
    expect(INKBOX_FORWARDED_HEADER_PREFIX).toBe(
      manifest.INKBOX_FORWARDED_HEADER_PREFIX,
    );
  });

  it("TunnelMetaHeader entries match the manifest", () => {
    for (const [k, v] of Object.entries(manifest.TunnelMetaHeader)) {
      expect((TunnelMetaHeader as Record<string, string>)[k]).toBe(v);
    }
    expect(Object.keys(TunnelMetaHeader).sort()).toEqual(
      Object.keys(manifest.TunnelMetaHeader).sort(),
    );
  });

  it("TunnelRouteKind entries match the manifest", () => {
    for (const [k, v] of Object.entries(manifest.TunnelRouteKind)) {
      expect((TunnelRouteKind as Record<string, string>)[k]).toBe(v);
    }
  });

  it("TunnelSubprotocol entries match the manifest", () => {
    for (const [k, v] of Object.entries(manifest.TunnelSubprotocol)) {
      expect((TunnelSubprotocol as Record<string, string>)[k]).toBe(v);
    }
  });

  it("ControlPaths and ControlHeaders match the manifest", () => {
    for (const [k, v] of Object.entries(manifest.ControlPaths)) {
      expect((ControlPaths as Record<string, string>)[k]).toBe(v);
    }
    for (const [k, v] of Object.entries(manifest.ControlHeaders)) {
      expect((ControlHeaders as Record<string, string>)[k]).toBe(v);
    }
  });

  it("hop-by-hop sets match the manifest", () => {
    expect([...HOP_BY_HOP_REQUEST].sort()).toEqual(
      [...manifest.HopByHopRequest].sort(),
    );
    expect([...HOP_BY_HOP_RESPONSE].sort()).toEqual(
      [...manifest.HopByHopResponse].sort(),
    );
  });
});
