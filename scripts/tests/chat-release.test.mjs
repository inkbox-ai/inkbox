import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkReleaseVersions } from "../check-release-versions.mjs";
import { publishChatAdapter } from "../../adapters/chat-sdk/publish.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const files = [
  "sdk/typescript/package.json",
  "sdk/typescript/package-lock.json",
  "sdk/typescript/src/version.ts",
  "adapters/chat-sdk/package.json",
  "adapters/chat-sdk/package-lock.json",
  "examples/chat-sdk/package-lock.json",
  "examples/eve-agent/package-lock.json",
  "cli/package.json",
  "cli/package-lock.json",
  "cli/src/client.ts",
  "sdk/python/pyproject.toml",
  "sdk/python/uv.lock",
  "sdk/rust/Cargo.toml",
  "sdk/rust/Cargo.lock",
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
    if (args[0] === "view" && args[2] === "version") {
      return { status: 0, stdout: JSON.stringify(version), stderr: "" };
    }
    if (args[0] === "pack") {
      const adapter = cwd.endsWith("chat-sdk");
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            name: adapter ? "@inkbox/chat-sdk-adapter" : "@inkbox/sdk",
            version,
            filename: adapter ? "adapter.tgz" : "sdk.tgz",
            integrity: adapter ? "sha512-adapter" : "sha512-sdk",
          },
        ]),
        stderr: "",
      };
    }
    if (args[0] === "view")
      return {
        status: 1,
        stdout: JSON.stringify({ error: { code: "E404" } }),
        stderr: "",
      };
    return { status: 0, stdout: "", stderr: "" };
  };
  return { calls, run };
}
function publish(root, run, production = false) {
  publishChatAdapter({ root, destination: root, production, run });
}

test("all package versions and local SDK links move together", () => {
  assert.match(checkReleaseVersions(repository), /^\d+\.\d+\.\d+$/);
});
for (const file of [
  "adapters/chat-sdk/package.json",
  "adapters/chat-sdk/package-lock.json",
  "examples/eve-agent/package-lock.json",
  "sdk/python/uv.lock",
  ".claude-plugin/plugin.json",
]) {
  test(`release refuses version drift in ${file}`, (t) => {
    const root = fixture(t);
    const version = checkReleaseVersions(root);
    const path = join(root, file);
    writeFileSync(path, readFileSync(path, "utf8").replace(version, "0.0.0"));
    const calls = [];
    assert.throws(
      () => publish(root, (...args) => calls.push(args)),
      /expected/,
    );
    assert.equal(calls.length, 0);
  });
}

test("adapter-only dry run builds against the exact published SDK without preparing the SDK", (t) => {
  const root = fixture(t);
  const version = checkReleaseVersions(root);
  const { calls, run } = runner(root);
  publish(root, run, false);
  assert.deepEqual(calls.map(({ args }) => args[0]), [
    "view", "install", "run", "pack", "view", "publish",
  ]);
  assert.deepEqual(calls[0].args, ["view", `@inkbox/sdk@${version}`, "version", "--json"]);
  assert.deepEqual(calls[1].args, [
    "install", "--ignore-scripts", "--no-save", "--package-lock=false", `@inkbox/sdk@${version}`,
  ]);
  assert.ok(calls.filter(({ args }) => ["ci", "install", "run", "pack"].includes(args[0]))
    .every(({ cwd }) => cwd === join(root, "adapters/chat-sdk")));
  assert.ok(!calls.some(({ args }) => args[0] === "ci"));
  const publishes = calls.filter(({ args }) => args[0] === "publish");
  assert.equal(publishes.length, 1);
  assert.equal(publishes[0].args[1], join(root, "adapter.tgz"));
  assert.ok(publishes[0].args.includes("--dry-run"));
  assert.ok(!calls.some(({ args }) => args[0] === "view" && args[1].startsWith("@inkbox/sdk@") && args[2] === "dist.integrity"));
});

for (const code of ["E404", "E503"]) {
  test(`adapter-only release stops before preparation when the SDK registry check returns ${code}`, (t) => {
    const root = fixture(t);
    const { calls, run } = runner(root, (args) => args[0] === "view"
      ? { status: 1, stdout: JSON.stringify({ error: { code } }), stderr: "" }
      : undefined);
    assert.throws(() => publish(root, run, true), /npm view failed/);
    assert.deepEqual(calls.map(({ args }) => args[0]), ["view"]);
  });
}

test("adapter-only release rejects an unexpected published SDK version", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root, (args) => args[0] === "view"
    ? { status: 0, stdout: JSON.stringify("0.0.0") }
    : undefined);
  assert.throws(() => publish(root, run, true), /requires published @inkbox\/sdk@/);
  assert.deepEqual(calls.map(({ args }) => args[0]), ["view"]);
});

test("adapter-only SDK installation failure prevents build and publication", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root, (args) => args[0] === "install"
    ? { status: 1, stderr: "dependency unavailable" }
    : undefined);
  assert.throws(() => publish(root, run, true), /dependency unavailable/);
  assert.ok(!calls.some(({ args }) => ["run", "pack", "publish"].includes(args[0])));
});

test("adapter-only production publishes only the adapter", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root);
  publish(root, run, true);
  const publishes = calls.filter(({ args }) => args[0] === "publish");
  assert.equal(publishes.length, 1);
  assert.equal(publishes[0].args[1], join(root, "adapter.tgz"));
  assert.ok(!publishes[0].args.includes("--dry-run"));
});

test("adapter-only retry skips an identical published adapter", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root, (args) => args[0] === "view" && args[2] === "dist.integrity"
    ? { status: 0, stdout: JSON.stringify("sha512-adapter") }
    : undefined);
  publish(root, run, true);
  assert.ok(!calls.some(({ args }) => args[0] === "publish"));
});

test("adapter-only release rejects a conflicting adapter without touching the SDK", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root, (args) => args[0] === "view" && args[2] === "dist.integrity"
    ? { status: 0, stdout: JSON.stringify("sha512-other") }
    : undefined);
  assert.throws(() => publish(root, run, true), /different contents/);
  assert.ok(!calls.some(({ args }) => args[0] === "publish"));
  assert.ok(!calls.some(({ cwd }) => cwd === join(root, "sdk/typescript")));
});

test("adapter build failure prevents publication", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root, (args) => args[0] === "run"
    ? { status: 1, stderr: "build failed" } : undefined);
  assert.throws(() => publish(root, run, true), /build failed/);
  assert.ok(!calls.some(({ args }) => args[0] === "publish"));
});

test("adapter registry failures are not treated as unpublished versions", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root, (args) => args[0] === "view" && args[2] === "dist.integrity"
    ? { status: 1, stdout: JSON.stringify({ error: { code: "E503" } }), stderr: "Unavailable" }
    : undefined);
  assert.throws(() => publish(root, run, true), /Cannot verify/);
  assert.ok(!calls.some(({ args }) => args[0] === "publish"));
});

test("adapter publication failures propagate", (t) => {
  const root = fixture(t);
  const { calls, run } = runner(root, (args) => args[0] === "publish"
    ? { status: 1, stderr: "publish failed" } : undefined);
  assert.throws(() => publish(root, run, true), /publish failed/);
  assert.equal(calls.filter(({ args }) => args[0] === "publish").length, 1);
});
