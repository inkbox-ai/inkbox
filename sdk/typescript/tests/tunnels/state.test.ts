/**
 * tests/tunnels/state.test.ts
 *
 * Direct coverage for `_state.ts` I/O paths the existing tests don't
 * exercise: writePrivateFile, printSecretOnce, defaultStateDir,
 * loadState parse-error paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  defaultStateDir,
  ensurePrivateStateDir,
  loadState,
  printSecretOnce,
  saveState,
  writePrivateFile,
} from "../../src/tunnels/client/_state.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkbox-state-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ensurePrivateStateDir", () => {
  it("creates a missing directory with mode 0o700", () => {
    const dir = path.join(tmpDir, "fresh");
    ensurePrivateStateDir(dir);
    const stat = fs.statSync(dir);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it("re-chmods an existing directory to 0o700", () => {
    const dir = path.join(tmpDir, "loose");
    fs.mkdirSync(dir, { mode: 0o755 });
    ensurePrivateStateDir(dir);
    const stat = fs.statSync(dir);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it("refuses to use a symlinked state_dir", () => {
    const real = path.join(tmpDir, "real");
    fs.mkdirSync(real);
    const link = path.join(tmpDir, "link");
    fs.symlinkSync(real, link);
    expect(() => ensurePrivateStateDir(link)).toThrowError(
      /symlinked state_dir/,
    );
  });
});

describe("loadState parse-error paths", () => {
  it("returns null when state.json is missing", () => {
    expect(loadState(tmpDir)).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "state.json"), "not-json");
    expect(loadState(tmpDir)).toBeNull();
  });

  it("normalizes missing optional fields to null", () => {
    saveState(tmpDir, {
      tunnelId: "abc",
      name: "n",
    });
    const loaded = loadState(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.secret).toBeNull();
    expect(loaded!.mode).toBeNull();
    expect(loaded!.zone).toBeNull();
    expect(loaded!.publicHost).toBeNull();
  });
});

describe("writePrivateFile", () => {
  it("creates a file with mode 0o600 via O_NOFOLLOW", () => {
    const target = path.join(tmpDir, "secret.bin");
    writePrivateFile(target, "hello");
    const stat = fs.statSync(target);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(target, "utf-8")).toBe("hello");
  });

  it("overwrites existing files atomically and re-chmods to 0o600", () => {
    const target = path.join(tmpDir, "secret.bin");
    fs.writeFileSync(target, "old", { mode: 0o644 });
    writePrivateFile(target, Buffer.from("new", "utf-8"));
    const stat = fs.statSync(target);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(target, "utf-8")).toBe("new");
  });
});

describe("printSecretOnce", () => {
  it("prints the banner to stderr when forced on", () => {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      }) as unknown as typeof process.stderr.write);
    printSecretOnce({
      secret: "sek-123",
      statePath: "/tmp/x/state.json",
      printToStderr: true,
    });
    spy.mockRestore();
    const out = writes.join("");
    expect(out).toContain("ONE-TIME connect_secret disclosure");
    expect(out).toContain("sek-123");
  });

  it("is a no-op when printToStderr=false", () => {
    let wrote = false;
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => {
        wrote = true;
        return true;
      }) as unknown as typeof process.stderr.write);
    printSecretOnce({
      secret: "sek",
      statePath: "/tmp/x",
      printToStderr: false,
    });
    spy.mockRestore();
    expect(wrote).toBe(false);
  });

  it("falls back to TTY check when printToStderr is null", () => {
    // process.stderr.isTTY may be undefined in vitest; accept either no-op
    // or printed-banner. The branch under test is the TTY-gated default.
    const original = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      get: () => false,
    });
    let wrote = false;
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => {
        wrote = true;
        return true;
      }) as unknown as typeof process.stderr.write);
    printSecretOnce({
      secret: "sek",
      statePath: "/tmp/x",
      printToStderr: null,
    });
    spy.mockRestore();
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      get: () => original,
    });
    expect(wrote).toBe(false);
  });
});

describe("defaultStateDir", () => {
  it("returns ~/.inkbox/tunnels/{name}", () => {
    const dir = defaultStateDir("my-agent");
    expect(dir).toBe(path.join(os.homedir(), ".inkbox", "tunnels", "my-agent"));
  });
});
