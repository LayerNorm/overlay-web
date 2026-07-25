# Gate B — clean Mac QA checklist

Use after a signed, notarized candidate exists. Do **not** remove the
`publish-mac` `if: ${{ false }}` freeze until this checklist and
[GATE_B_BINARY_RELEASE_CHECKLIST.md](../GATE_B_BINARY_RELEASE_CHECKLIST.md)
are signed.

**Release SHA:** ________________  
**Version / tag:** ________________  
**Tester:** ________________  
**Date:** ________________  

## Preconditions

- [ ] Apple Developer Team ID confirmed
- [ ] Bundle ID `com.layernorm.overlay` (or current) ownership confirmed
- [ ] Developer ID Application certificate valid
- [ ] Notarization credentials present only in `mac-release` environment
- [ ] Candidate built from immutable 40-character SHA
- [ ] Nested signatures, hardened runtime, entitlements, fuses, ASAR, SBOM,
      native-helper hashes verified in CI logs

## Clean Apple Silicon Mac (no local `.env`, no developer certs installed)

- [ ] Download DMG via getoverlay.io `/api/latest-release/download` (flag enabled
      only for this QA window if needed)
- [ ] Gatekeeper accepts open (no unidentified-developer block after staple)
- [ ] App name in dialogs is **Overlay**, not Electron
- [ ] First-run sign-in completes against production Overlay Server
- [ ] Ask for approval: one host tool prompts; cancel works
- [ ] Full access: native warning required; cancel default
- [ ] Microphone / Accessibility prompts behave as documented
- [ ] Browser permission + restricted destination blocks observed
- [ ] Local transcription helper starts (if shipped)
- [ ] Optional diagnostics remain off by default

## Updater

- [ ] Update prompt appears for a newer signed build
- [ ] Interrupted update recovers safely
- [ ] Replay of old metadata rejected
- [ ] Downgrade rejected
- [ ] Compromised / mismatched metadata fails closed
- [ ] Rollback path documented and timed

## Uninstall

- [ ] Quit + delete app
- [ ] Local data retained under Application Support until manually removed
- [ ] Cloud account data unaffected

## Website parity

- [ ] `/download` shows same version as GitHub Release + updater metadata
- [ ] Safari + Chrome signed-out download works
- [ ] Mobile browsers show clear Apple Silicon / Mac-only messaging

## Sign-off

| Role | Name | Result | Date |
| --- | --- | --- | --- |
| Release owner | | PASS / FAIL | |
| QA | | PASS / FAIL | |
