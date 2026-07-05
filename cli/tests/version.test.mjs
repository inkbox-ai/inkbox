import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLI_VERSION } from "../dist/client.js";

test("CLI_VERSION matches package.json version (the User-Agent constant must not drift)", () => {
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  assert.equal(CLI_VERSION, pkg.version);
});
