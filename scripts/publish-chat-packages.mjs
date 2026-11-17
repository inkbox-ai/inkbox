import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkReleaseVersions } from "./check-release-versions.mjs";

const packages = [
  { name: "@inkbox/sdk", directory: "sdk/typescript" },
  { name: "@inkbox/chat-sdk-adapter", directory: "adapters/chat-sdk" },
];

function npm(args, cwd) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Build both packages before publishing either; rerun to finish a partial release. */
export function publishChatPackages({ root, destination, production = false, run = npm }) {
  const version = checkReleaseVersions(root);
  const checked = (args, cwd) => {
    const result = run(args, cwd);
    if (result.status !== 0) throw new Error(`npm ${args[0]} failed: ${result.stderr || result.stdout}`);
    return result.stdout;
  };
  const packed = [];
  for (const pkg of packages) {
    const cwd = join(root, pkg.directory);
    checked(["ci", "--ignore-scripts"], cwd);
    rmSync(join(cwd, "dist"), { recursive: true, force: true });
    checked(["run", "build"], cwd);
    const [artifact] = JSON.parse(checked(["pack", "--ignore-scripts", "--json", "--pack-destination", destination], cwd));
    if (artifact.name !== pkg.name || artifact.version !== version || !artifact.integrity || !artifact.filename) {
      throw new Error(`Unexpected package artifact for ${pkg.name}`);
    }
    packed.push({ ...pkg, ...artifact, cwd });
  }

  // Check both immutable versions before the first registry mutation.
  for (const pkg of packed) {
    if (!production) continue;
    const result = run(["view", `${pkg.name}@${version}`, "dist.integrity", "--json"], root);
    if (result.status === 0) {
      if (JSON.parse(result.stdout) !== pkg.integrity) {
        throw new Error(`${pkg.name}@${version} is already published with different contents; choose a new release version.`);
      }
      pkg.published = true;
    } else {
      let error;
      try { error = JSON.parse(result.stdout).error; } catch { /* npm may write JSON errors to stderr. */ }
      if (!error) {
        try { error = JSON.parse(result.stderr).error; } catch { /* Preserve failure below. */ }
      }
      if (error?.code !== "E404") {
        throw new Error(`Cannot verify ${pkg.name}@${version}: ${result.stderr || result.stdout}`);
      }
    }
  }
  for (const pkg of packed) {
    if (pkg.published) {
      console.log(`Already published with matching contents: ${pkg.name}@${version}`);
      continue;
    }
    checked(["publish", join(destination, pkg.filename), "--ignore-scripts", "--access", "public", ...(!production ? ["--dry-run"] : [])], root);
    console.log(`${production ? "Published" : "Dry run complete"}: ${pkg.name}@${version}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--prod") || args.length > 1) {
    throw new Error("Usage: node scripts/publish-chat-packages.mjs [--prod]");
  }
  const destination = mkdtempSync(join(tmpdir(), "inkbox-release-"));
  try {
    publishChatPackages({
      root: fileURLToPath(new URL("../", import.meta.url)), destination,
      production: args.includes("--prod"),
    });
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
}
