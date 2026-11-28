# Third-Party Notices

Overlay Desktop includes third-party JavaScript packages, native modules,
frameworks, models, and helper binaries. Each component remains subject
to its own license and notice requirements.

The authoritative JavaScript dependency set is the desktop workspace in the
repository's `bun.lock`. Run `bun run license:check` and generate the CycloneDX
SBOM before a release. The
check does not replace legal review of the final packaged artifact.

Important native and model components include:

- Electron and Chromium — licenses distributed by the Electron project.
- WhisperKit — MIT-licensed upstream source pinned to
  `cb00a08d08d2dad37ca8aa488ee0695e97ab6045`. The bundled helper hash and build
  recipe are recorded in `native-artifacts.json`.
- FluidAudio/Parakeet helper — Apache-2.0 upstream code pinned through
  `Package.resolved` to `2d18c856aad09b509d07322ae2e811f06c98a2a9`.
- NVIDIA Parakeet CoreML model files — CC-BY-4.0, downloaded from immutable
  model revision `ee09c569f73759e6d44c9bd16766f477b2b36d39`. Preserve attribution
  if the downloaded files are redistributed.
- WhisperKit CoreML model files — downloaded from immutable model revision
  `97a5bf9bbc74c7d9c12c755d04dea59e672e3808`. The pinned model card is
  preserved under `third_party/licenses`.
- Node.js — the official Apple silicon build, pinned by checksum in
  `native-artifacts.json` and downloaded by `scripts/build-agent-host-bundle.mjs`.
  It runs the bundled Agent Host. Its license, which also covers the libraries
  compiled into it, is preserved as `third_party/licenses/Node-LICENSE`.
- Overlay Agent Host (`@layernorm/overlay-agent-host`) — AGPL-3.0-only, pinned by
  `agent-host-bundle/package-lock.json`.
- Native npm dependencies — licenses recorded in their package metadata and the
  generated SBOM.

`bun run check:native-artifacts` verifies hashes, architecture, build records,
licenses, source records, and absence of private workstation paths for every
bundled executable. Official release evidence must also preserve the generated
SBOM and model revision records. A locally present binary is not sufficient
provenance.
