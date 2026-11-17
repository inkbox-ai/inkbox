import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkReleaseVersions } from "../check-release-versions.mjs";
import { publishChatPackages } from "../publish-chat-packages.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const files = [
  "sdk/typescript/package.json", "sdk/typescript/package-lock.json", "sdk/typescript/src/version.ts",
  "adapters/chat-sdk/package.json", "adapters/chat-sdk/package-lock.json",
  "examples/chat-sdk/package-lock.json", "examples/eve-agent/package-lock.json",
  "cli/package.json", "cli/package-lock.json", "cli/src/client.ts",
  "sdk/python/pyproject.toml", "sdk/python/uv.lock", "sdk/rust/Cargo.toml", "sdk/rust/Cargo.lock",
  ".claude-plugin/plugin.json",
];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "inkbox-release-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), readFileSync(join(repository, file)));
  }
  return root;
}
function runner(root, override = () => undefined) {
  const calls = [];
  const version = checkReleaseVersions(root);
  const run = (args, cwd) => {
    calls.push({ args, cwd });
    const custom = override(args, cwd);
    if (custom) return custom;
    if (args[0] === "pack") {
      const adapter = cwd.endsWith("chat-sdk");
      return { status: 0, stdout: JSON.stringify([{
        name: adapter ? "@inkbox/chat-sdk-adapter" : "@inkbox/sdk",
        version, filename: adapter ? "adapter.tgz" : "sdk.tgz",
        integrity: adapter ? "sha512-adapter" : "sha512-sdk",
      }]), stderr: "" };
    }
    if (args[0] === "view") return { status: 1, stdout: JSON.stringify({ error: { code: "E404" } }), stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  return { calls, run };
}
function publish(root, run, production = false) {
  publishChatPackages({ root, destination: root, production, run });
}

test("all package versions and local SDK links move together", () => {
  assert.match(checkReleaseVersions(repository), /^\d+\.\d+\.\d+$/);
});
for (const file of ["adapters/chat-sdk/package.json", "adapters/chat-sdk/package-lock.json", "examples/eve-agent/package-lock.json", "sdk/python/uv.lock", ".claude-plugin/plugin.json"]) {
  test(`release refuses version drift in ${file}`, (t) => {
    const root = fixture(t);
    const version = checkReleaseVersions(root);
    const path = join(root, file);
    writeFileSync(path, readFileSync(path, "utf8").replace(version, "0.0.0"));
    const calls = [];
    assert.throws(() => publish(root, (...args) => calls.push(args)), /expected/);
    assert.equal(calls.length, 0);
  });
}

test("dry run builds and packs both before publishing SDK then adapter", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root);
  publish(root, run);
  assert.deepEqual(calls.map(({ args }) => args[0]), ["ci", "run", "pack", "ci", "run", "pack", "publish", "publish"]);
  const publishes = calls.filter(({ args }) => args[0] === "publish");
  assert.equal(publishes[0].args[1], join(root, "sdk.tgz"));
  assert.equal(publishes[1].args[1], join(root, "adapter.tgz"));
  assert.ok(publishes.every(({ args }) => args.includes("--dry-run")));
});

test("adapter build failure prevents any publication", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root, (args, cwd) =>
    args[0] === "run" && cwd.endsWith("chat-sdk") ? { status: 1, stderr: "build failed" } : undefined);
  assert.throws(() => publish(root, run, true), /build failed/);
  assert.ok(!calls.some(({ args }) => args[0] === "publish"));
});

test("partial release resumes without republishing identical SDK", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root, (args) =>
    args[0] === "view" && args[1].startsWith("@inkbox/sdk@")
      ? { status: 0, stdout: JSON.stringify("sha512-sdk") } : undefined);
  publish(root, run, true);
  const publishes = calls.filter(({ args }) => args[0] === "publish");
  assert.equal(publishes.length, 1);
  assert.equal(publishes[0].args[1], join(root, "adapter.tgz"));
  assert.ok(!publishes[0].args.includes("--dry-run"));
});

test("different existing adapter contents prevent publishing either package", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root, (args) =>
    args[0] === "view" && args[1].startsWith("@inkbox/chat-sdk-adapter@")
      ? { status: 0, stdout: JSON.stringify("sha512-other") } : undefined);
  assert.throws(() => publish(root, run, true), /different contents/);
  assert.ok(!calls.some(({ args }) => args[0] === "publish"));
});

test("registry failures are not treated as unpublished versions", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root, (args) => args[0] === "view"
    ? { status: 1, stdout: JSON.stringify({ error: { code: "E401" } }), stderr: "Unauthorized" } : undefined);
  assert.throws(() => publish(root, run, true), /Cannot verify/);
  assert.ok(!calls.some(({ args }) => args[0] === "publish"));
});

test("SDK publish failure does not publish adapter", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root, (args) => args[0] === "publish"
    ? { status: 1, stderr: "publish failed" } : undefined);
  assert.throws(() => publish(root, run, true), /publish failed/);
  assert.equal(calls.filter(({ args }) => args[0] === "publish").length, 1);
});
