import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkReleaseVersions(root) {
  const read = (path) => readFileSync(resolve(root, path), "utf8");
  const json = (path) => JSON.parse(read(path));
  const version = json("sdk/typescript/package.json").version;
  const expect = (actual, path, expected = version) => {
    if (actual !== expected) {
      throw new Error(`${path}: expected ${expected}, received ${actual}`);
    }
  };
  for (const path of ["cli", "sdk/typescript", "adapters/chat-sdk"]) {
    const manifest = json(`${path}/package.json`);
    const lock = json(`${path}/package-lock.json`);
    expect(manifest.version, `${path}/package.json version`);
    expect(lock.version, `${path}/package-lock.json version`);
    expect(lock.packages[""].version, `${path}/package-lock.json root version`);
    if (path !== "sdk/typescript") {
      expect(manifest.dependencies["@inkbox/sdk"], `${path} SDK dependency`, `^${version}`);
      expect(lock.packages[""].dependencies["@inkbox/sdk"], `${path} locked SDK dependency`, `^${version}`);
      const sdk = Object.entries(lock.packages).find(([key]) => key.endsWith("sdk/typescript"));
      expect(sdk?.[1].version, `${path} linked SDK version`);
    }
  }
  for (const path of ["sdk/python/pyproject.toml", "sdk/rust/Cargo.toml"]) {
    expect(read(path).match(/^version = "([^"]+)"/m)?.[1], path);
  }
  for (const path of ["examples/chat-sdk", "examples/eve-agent"]) {
    const lock = json(`${path}/package-lock.json`);
    expect(lock.packages["../../adapters/chat-sdk"]?.version, `${path} linked adapter version`);
    expect(lock.packages["../../adapters/chat-sdk"]?.dependencies["@inkbox/sdk"], `${path} linked adapter SDK dependency`, `^${version}`);
    const sdk = lock.packages["../../sdk/typescript"];
    if (sdk) expect(sdk.version, `${path} linked SDK version`);
  }
  for (const path of ["sdk/python/uv.lock", "sdk/rust/Cargo.lock"]) {
    expect(read(path).match(/\[\[package\]\]\nname = "inkbox"\nversion = "([^"]+)"/)?.[1], path);
  }
  expect(json(".claude-plugin/plugin.json").version, ".claude-plugin/plugin.json");
  expect(read("sdk/typescript/src/version.ts").match(/VERSION = "([^"]+)"/)?.[1], "SDK User-Agent version");
  expect(read("cli/src/client.ts").match(/CLI_VERSION = "([^"]+)"/)?.[1], "CLI User-Agent version");
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Release versions agree: ${checkReleaseVersions(fileURLToPath(new URL("../", import.meta.url)))}`);
}
