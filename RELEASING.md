# Releasing

This repo ships four packages whose versions move **in lockstep**:

| Package | Dir | Registry | Install |
|---|---|---|---|
| `inkbox` (Python) | `sdk/python/` | PyPI | `pip install inkbox` |
| `@inkbox/sdk` (TypeScript) | `sdk/typescript/` | npm | `npm install @inkbox/sdk` |
| `@inkbox/cli` | `cli/` | npm | `npm install -g @inkbox/cli` |
| `inkbox` (Rust) | `sdk/rust/` | crates.io | `cargo add inkbox` |

Each package has its own `publish.sh`: **dry run by default**, `--prod` to publish for real.

## 1. Bump versions (all four, same number)

When a PR bumps a package version, prefix its title with the new semantic version
in backticks, followed by a colon and space: `` `0.0.0`: PR title ``.

| File | Field |
|---|---|
| `sdk/python/pyproject.toml` (+ `uv.lock` self-entry — run `uv lock`) | `version` |
| `sdk/typescript/package.json` (+ `package-lock.json` self-version) | `version` |
| `sdk/typescript/src/version.ts` | `VERSION` (User-Agent constant; unit-tested against package.json) |
| `cli/package.json` (+ `package-lock.json`) | `version` **and** the `@inkbox/sdk` dependency → `^<new version>` |
| `cli/src/client.ts` | `CLI_VERSION` (User-Agent constant) |
| `sdk/rust/Cargo.toml` (+ `Cargo.lock` `inkbox` entry) | `version` |
| `.claude-plugin/plugin.json` | `version` |

The CLI declares `@inkbox/sdk: ^<version>` and `cli/publish.sh` refuses to publish unless that matches `sdk/typescript`'s version — so bump it too.

The plugin isn't published to a registry, but its version is the cache key Claude
Code uses to decide whether an installed copy is out of date. Leaving it behind
means people who already installed the plugin keep the old skills no matter how
many commits land, so it moves with the same number as everything else.

## 2. Update the changelog

Add the release section to `CHANGELOG.md` (newest on top), then commit the bump + changelog.

## Availability gate for bundled skills and documentation

The marketplace installs this repository's `main` branch; it does not wait for a
package registry release. A plugin version bump does not prevent a fresh install
from receiving new instructions early.

For a release that adds SDK or CLI features:

1. Choose the next unused version and update all four packages and the bundled
   plugin together. Do not reuse a version that is already published.
2. Verify the matching public API is available and all package checks pass for the
   exact release commit. Leave feature documentation and skills unmerged until the
   packages implementing their examples are available.
3. With publication approval, publish from that reviewed release commit in the
   order below. Verify registry propagation by installing each exact version in a
   clean environment and exercising its documented imports and command help.
4. Update affected integration-plugin dependency pins and validate their install
   and invocation paths. Inventory both runtime manifests and CI install commands.
5. Only then merge the matching skills and publish the feature documentation. If
   any package is unavailable, keep those instructions off `main`; do not rely on
   users already having a cached plugin installation.

Keep the root changelog canonical. Package changelogs should link to it instead
of maintaining duplicate feature lists.

## 3. Publish — order matters

Publish the **TypeScript SDK before the CLI** (the CLI depends on it; its `publish.sh` runs `npm install`, which resolves the just-published `@inkbox/sdk`). Python and Rust have no cross-deps and can go anytime.

Run all four from the repo root, in this order:

```bash
(cd sdk/typescript && ./publish.sh --prod)   # npm        — @inkbox/sdk (first)
(cd cli            && ./publish.sh --prod)   # npm        — @inkbox/cli
(cd sdk/python     && ./publish.sh --prod)   # PyPI       — inkbox
(cd sdk/rust       && ./publish.sh --prod)   # crates.io  — inkbox
```

(Each script also runs as a dry run without `--prod`, if you want to preview first.)

## 4. Credentials (one-time per machine)

Each `publish.sh` sources `.env` from the repo root. Set up registry auth:

- **PyPI** — put `TWINE_PASSWORD=<pypi-api-token>` in `.env` (the script sets `TWINE_USERNAME=__token__`). The non-`--prod` path targets TestPyPI.
- **npm** (`@inkbox/sdk`, `@inkbox/cli`) — be logged in (`npm login`) or have an `authToken` in `~/.npmrc`.
- **crates.io** — put `CARGO_REGISTRY_TOKEN=<crates.io-token>` in `.env`, or run `cargo login` once. Get the token from crates.io → Account Settings → API Tokens. **First publish gotchas:** crates.io refuses to publish until your account email is **verified** (Account Settings → Email), and the token needs the **`publish-new`** scope to publish a crate that doesn't exist yet (`publish-update` alone 403s the first publish).

## 5. Tag

After all four are live:

```bash
git tag v<version> && git push --tags
```

## Notes

- crates.io and npm/PyPI versions are **immutable** — a published version can't be overwritten, only yanked/deprecated. Get the dry run right.
- crate/package names are claimed by the first publisher; the first `--prod` for a new package claims the name on that registry.
