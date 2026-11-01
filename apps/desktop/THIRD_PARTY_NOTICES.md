# Third-Party Notices

Overlay Desktop includes third-party JavaScript packages, native modules,
frameworks, fonts, models, and helper binaries. Each component remains subject
to its own license and notice requirements.

The authoritative JavaScript dependency set is `package-lock.json`. Run
`npm run license:check` and generate the CycloneDX SBOM before a release. The
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
- LanceDB and native npm dependencies — licenses recorded in their package
  metadata and the generated SBOM.

`npm run check:native-artifacts` verifies hashes, architecture, build records,
licenses, source records, and absence of private workstation paths for every
bundled executable. Official release evidence must also preserve the generated
SBOM and model revision records. A locally present binary is not sufficient
provenance.
