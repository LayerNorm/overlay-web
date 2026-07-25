# Overlay macOS Release Process

Official desktop releases are frozen until every Gate B requirement in this
guide is signed off. The workflow keeps both
release jobs disabled with `if: ${{ false }}` until that review is complete.

## Supported artifact

- macOS on Apple Silicon (`arm64`) only
- Developer ID signed and Apple-notarized DMG
- signed ZIP plus `latest-mac.yml` for the stable updater channel
- CycloneDX SBOM, SHA-256 release manifest, and GitHub build provenance

Intel and universal artifacts are not supported until every bundled native
helper is rebuilt and verified for those architectures.

## Required repository controls

- Protect the `mac-release` and `release-publish` GitHub environments on
  `LayerNorm/overlay-desktop`.
- Require reviewer approval for both environments.
- Store Apple signing/notarization credentials only in `mac-release`
  (not repository-level secrets).
- Publish signed artifacts as **GitHub Releases on the same public repo**
  (`LayerNorm/overlay-desktop`). The publish job uses `GITHUB_TOKEN` with
  `contents: write`; the build job never receives write access.
- The legacy `DevelopedByDev/overlay-releases` repository is private/retired.
  Do not publish new public DMGs there.
- Do not store copies of production credentials in repository `.env` files.
- Keep all Actions pinned to immutable commit SHAs.

## Pre-release gates

From a clean standalone checkout at the exact source commit:

```bash
npm ci
npm run check:standalone
npm run license:check
npm run check:dependencies:all
npm run check:release-security
npm test
npm run build
```

Gate B also requires the independent review, clean-machine test, secret/history
scan, and packaged adversarial QA listed in the remediation plan. A green CI
build alone is not approval to publish.

## Build and publish design

The manual workflow requires a full 40-character `release_source_sha`.

1. The build job checks out exactly that SHA without persisted credentials.
2. It audits dependencies and runs the release boundary checks.
3. It builds, signs, and notarizes without a release-repository token.
4. It generates the SBOM and verifies signatures, Gatekeeper, notarization
   staples, Electron fuses, ASAR contents, updater metadata, and artifact hashes.
5. GitHub attests the verified artifacts and stores them as a short-lived
   immutable workflow artifact.
6. Only the separate protected publish job creates the narrowly scoped GitHub
   App token and uploads the already-verified files.

The publishing token must never be available to install scripts, compilers,
packagers, or artifact verification.

## Enabling the workflow after Gate B

After the Gate B approval is recorded:

1. Remove `if: ${{ false }}` from both `build-mac` and `publish-mac` in the same
   reviewed commit.
2. Confirm environment protection and secret placement in GitHub.
3. Dispatch **Release macOS** with the reviewed full commit SHA.
4. Confirm the build and publish jobs reference the same SHA.
5. Verify the public release contains the DMG, ZIP, updater metadata, SBOM,
   release manifest, and provenance.
6. On a clean Apple Silicon Mac, install the DMG and verify Gatekeeper, sign-in,
   updates, chat approvals, browser permissions, voice helpers, and revocation of
   optional diagnostics.

## Updater policy

The app uses only the `latest` stable channel. It rejects malformed versions,
prereleases, same-version replays, and downgrades. A validated update may
download in the background, but installation always requires explicit user
action.

## Local packaging

Unsigned local packaging can exercise ASAR and fuse checks, but it is not
release evidence:

```bash
npm run build
npx electron-builder --mac --arm64 --dir --publish never
npm run generate:sbom
ALLOW_UNSIGNED_LOCAL_ARTIFACT=1 npm run verify:mac-artifact
```

Never use the local unsigned override in release CI.

For a faster directory-only package (without DMG, ZIP, or updater metadata), use
both local-only flags:

```bash
ALLOW_UNSIGNED_LOCAL_ARTIFACT=1 \
ALLOW_DIRECTORY_ONLY_LOCAL_ARTIFACT=1 \
npm run verify:mac-artifact
```

The directory-only mode still verifies Electron fuses, ASAR exclusions, secret
and workstation-path scans, the SBOM, and exact hashes of packaged native
helpers. Both overrides are forbidden in release CI.
