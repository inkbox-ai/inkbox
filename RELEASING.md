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

| File | Field |
|---|---|
| `sdk/python/pyproject.toml` (+ `uv.lock` self-entry — run `uv lock`) | `version` |
| `sdk/typescript/package.json` (+ `package-lock.json` self-version) | `version` |
| `sdk/typescript/src/version.ts` | `VERSION` (User-Agent constant; unit-tested against package.json) |
| `cli/package.json` (+ `package-lock.json`) | `version` **and** the `@inkbox/sdk` dependency → `^<new version>` |
| `cli/src/client.ts` | `CLI_VERSION` (User-Agent constant) |
| `sdk/rust/Cargo.toml` (+ `Cargo.lock` `inkbox` entry) | `version` |

The CLI declares `@inkbox/sdk: ^<version>` and `cli/publish.sh` refuses to publish unless that matches `sdk/typescript`'s version — so bump it too.

## 2. Update the changelog

Add the release section to `CHANGELOG.md` (newest on top), then commit the bump + changelog.

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
