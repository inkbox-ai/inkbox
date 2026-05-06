/**
 * tests/tunnels/connect.test.ts
 *
 * Synchronous failure-path coverage for `connect()`. The full bootstrap
 * path is exercised end-to-end by the integration tests; this file
 * covers the cheap synchronous validation branches that fail BEFORE
 * any Inkbox-client method is invoked.
 */

import { describe, expect, it } from "vitest";
import {
  InvalidConnectOptions,
  connect,
} from "../../src/tunnels/client/index.js";
import { ForwardTargetRefused } from "../../src/tunnels/client/_validation.js";
import { TunnelNameInvalid } from "../../src/tunnels/exceptions.js";
import type { Inkbox } from "../../src/inkbox.js";

// Stub Inkbox client. None of these tests should reach a method on it
// — every assertion lives upstream of the bootstrap.
const stubInkbox = {} as unknown as Inkbox;

describe("connect() — synchronous validation failures", () => {
  it("rejects an invalid tunnel name", async () => {
    await expect(
      connect(stubInkbox, {
        name: "--bad",
        forwardTo: "http://localhost:8080",
      }),
    ).rejects.toBeInstanceOf(TunnelNameInvalid);
  });

  it("rejects a poolSize out of range", async () => {
    await expect(
      connect(stubInkbox, {
        name: "my-agent",
        forwardTo: "http://localhost:8080",
        poolSize: 99,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("rejects a non-integer poolSize", async () => {
    await expect(
      connect(stubInkbox, {
        name: "my-agent",
        forwardTo: "http://localhost:8080",
        poolSize: 1.5,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("rejects no dispatch path (none of forwardTo, handler, wsHandler)", async () => {
    await expect(
      connect(stubInkbox, { name: "my-agent" }),
    ).rejects.toBeInstanceOf(InvalidConnectOptions);
  });

  it("rejects ambiguous dispatch (both forwardTo and handler)", async () => {
    await expect(
      connect(stubInkbox, {
        name: "my-agent",
        forwardTo: "http://localhost:8080",
        handler: async () => new Response("ok"),
      }),
    ).rejects.toBeInstanceOf(InvalidConnectOptions);
  });

  it("rejects wsHandler without an HTTP path", async () => {
    await expect(
      connect(stubInkbox, {
        name: "my-agent",
        wsHandler: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(InvalidConnectOptions);
  });

  it("rejects a non-loopback forwardTo by default", async () => {
    await expect(
      connect(stubInkbox, {
        name: "my-agent",
        forwardTo: "http://example.com:8080",
      }),
    ).rejects.toBeInstanceOf(ForwardTargetRefused);
  });

  it("accepts non-loopback forwardTo when allowRemoteForwarding=true", async () => {
    // We can't run the full bootstrap without an Inkbox mock, so the
    // assertion is "the validation path doesn't reject" — meaning this
    // call advances past synchronous validation and fails later
    // (cannot reach Inkbox methods on a {} stub).
    await expect(
      connect(stubInkbox, {
        name: "my-agent",
        forwardTo: "http://example.com:8080",
        allowRemoteForwarding: true,
      }),
    ).rejects.not.toBeInstanceOf(ForwardTargetRefused);
  });

  it("allows the in-process handler dispatch path through validation", async () => {
    await expect(
      connect(stubInkbox, {
        name: "my-agent",
        handler: async () => new Response("ok"),
      }),
    ).rejects.not.toBeInstanceOf(InvalidConnectOptions);
  });
});
