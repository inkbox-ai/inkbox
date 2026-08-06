import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLI_VERSION } from "../dist/client.js";

function readJson(relativePath) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

function readTomlVersion(relativePath, section) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = readFileSync(path, "utf8");
  const sectionStart = source.indexOf(`[${section}]`);
  assert.notEqual(sectionStart, -1, `Missing [${section}] in ${relativePath}`);
  const version = source.slice(sectionStart).match(/^version = "([^"]+)"/m);
  assert.ok(version, `Missing version in [${section}] of ${relativePath}`);
  return version[1];
}

function readLockedPackageVersion(relativePath, packageName) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = readFileSync(path, "utf8");
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      String.raw`\[\[package\]\]\r?\nname = "${escaped}"\r?\nversion = "([^"]+)"`,
    ),
  );
  assert.ok(match, `Missing ${packageName} package in ${relativePath}`);
  return match[1];
}

test("CLI_VERSION matches package.json version (the User-Agent constant must not drift)", () => {
  const pkg = readJson("../package.json");
  assert.equal(CLI_VERSION, pkg.version);
});

test("all release surfaces share one version and the CLI targets that SDK release", () => {
  const cliPackage = readJson("../package.json");
  const cliLock = readJson("../package-lock.json");
  const pluginManifest = readJson("../../.claude-plugin/plugin.json");
  const typescriptPackage = readJson("../../sdk/typescript/package.json");
  const typescriptLock = readJson("../../sdk/typescript/package-lock.json");
  const pythonVersion = readTomlVersion("../../sdk/python/pyproject.toml", "project");
  const pythonLockVersion = readLockedPackageVersion(
    "../../sdk/python/uv.lock",
    "inkbox",
  );
  const rustVersion = readTomlVersion("../../sdk/rust/Cargo.toml", "package");
  const rustLockVersion = readLockedPackageVersion(
    "../../sdk/rust/Cargo.lock",
    "inkbox",
  );

  assert.equal(typescriptPackage.version, cliPackage.version);
  assert.equal(pluginManifest.version, cliPackage.version);
  assert.equal(pythonVersion, cliPackage.version);
  assert.equal(pythonLockVersion, cliPackage.version);
  assert.equal(rustVersion, cliPackage.version);
  assert.equal(rustLockVersion, cliPackage.version);
  assert.equal(typescriptLock.packages[""].version, cliPackage.version);
  assert.equal(
    cliPackage.dependencies["@inkbox/sdk"],
    `^${cliPackage.version}`,
  );
  assert.equal(cliLock.packages[""].version, cliPackage.version);
  assert.equal(
    cliLock.packages[""].dependencies["@inkbox/sdk"],
    `^${cliPackage.version}`,
  );
  assert.equal(
    cliLock.packages["../sdk/typescript"].version,
    cliPackage.version,
  );
});
