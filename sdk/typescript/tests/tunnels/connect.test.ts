/**
 * tests/tunnels/connect.test.ts
 *
 * Synchronous failure-path coverage for `connect()`. The full bootstrap
 * path is exercised end-to-end by the integration tests; this file
 * covers the cheap synchronous validation branches that fail BEFORE
 * any Inkbox-client method is invoked.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InkboxAPIError } from "../../src/_http.js";
import {
  InvalidConnectOptions,
  connect,
} from "../../src/tunnels/client/index.js";
import { ForwardTargetRefused } from "../../src/tunnels/client/_validation.js";
import { TunnelNameInvalid, TunnelRemoved } from "../../src/tunnels/exceptions.js";
import { saveState } from "../../src/tunnels/client/_state.js";
import type { Inkbox } from "../../src/inkbox.js";

// Stub Inkbox client. None of these tests should reach a method on it
// — every assertion lives upstream of the bootstrap.
const stubInkbox = {} as unknown as Inkbox;

it("preserves Support Agent instructions when a stored tunnel was removed", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkbox-connect-test-"));
  const support = "Contact the Support Agent using its Agent Card.";
  saveState(stateDir, {
    tunnelId: "11111111-1111-1111-1111-111111111111",
    name: "my-agent",
  });
  const inkbox = {
    tunnels: {
      get: vi.fn().mockRejectedValue(new InkboxAPIError(404, "not found", null, support)),
    },
  } as unknown as Inkbox;

  try {
    const error = await connect(inkbox, {
      name: "my-agent",
      stateDir,
      forwardTo: "http://127.0.0.1:8080",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TunnelRemoved);
    expect(error).toMatchObject({ agentSupport: support });
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

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

describe("connect() — passthrough scheme handling", () => {
  // Passthrough accepts both http:// and https://; UpstreamUrlDispatch
  // handles upstream TLS via undici when scheme is https. These tests
  // assert that passthrough validation does not reject either scheme
  // synchronously — failures come from downstream (the stub Inkbox not
  // having tunnel methods).

  it("accepts passthrough + http:// forwardTo through synchronous validation", async () => {
    await expect(
      connect(stubInkbox, {
        name: "my-agent",
        tlsMode: "passthrough",
        forwardTo: "http://127.0.0.1:8080",
      }),
    ).rejects.not.toMatchObject({
      name: "InvalidConnectOptions",
      message: expect.stringMatching(/http:\/\//),
    });
  });

  it("accepts passthrough + https:// forwardTo", async () => {
    await expect(
      connect(stubInkbox, {
        name: "my-agent",
        tlsMode: "passthrough",
        forwardTo: "https://127.0.0.1:8443",
      }),
    ).rejects.not.toMatchObject({
      name: "InvalidConnectOptions",
      message: expect.stringMatching(/http:\/\//),
    });
  });

  it("does NOT reject edge + https:// forwardTo", async () => {
    // Edge URL forwarding terminates upstream TLS via undici and
    // supports https:// (regression check: shared validator unchanged).
    await expect(
      connect(stubInkbox, {
        name: "my-agent",
        tlsMode: "edge",
        forwardTo: "https://127.0.0.1:8443",
      }),
    ).rejects.not.toMatchObject({
      name: "InvalidConnectOptions",
      message: expect.stringMatching(/http:\/\//),
    });
  });
});
