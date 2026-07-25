# Removing the publish freeze (after Apple creds confirmed)

The `publish-mac` job in `.github/workflows/release-mac.yml` is intentionally
gated with `if: ${{ false }}`. **Do not remove that gate** until all items below
are true.

## Owner checklist (you)

- [ ] Apple Developer account + Team ID confirmed
- [ ] `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` current in
      `mac-release` environment
- [ ] `CSC_LINK` / `CSC_KEY_PASSWORD` current in `mac-release`
- [ ] Developer ID Application certificate valid for `com.layernorm.overlay`
- [ ] Notarization dry-run succeeded on a signed build from `mac-release`
- [ ] Gate A signed for the same source lineage

## Agent / release engineer checklist

- [ ] `build-mac` signed dry-run green on the candidate SHA
- [ ] Nested signature / fuse / SBOM / native-helper verification green
- [ ] [GATE_B_CLEAN_MAC_QA.md](./GATE_B_CLEAN_MAC_QA.md) prepared
- [ ] Change `publish-mac` `if: ${{ false }}` → environment-protected condition
      reviewed in a dedicated PR (do not sneak into unrelated commits)
- [ ] First public tag built from 40-char SHA only
- [ ] Website `OVERLAY_DESKTOP_DOWNLOADS_ENABLED=1` only **after** Gate B sign-off

## Freeze removal PR template

1. Title: `release: unfreeze publish-mac after Gate B approval`
2. Body links Gate A + Gate B evidence
3. Required reviewers: CODEOWNERS release owners
4. Merge only with admin approval after QA PASS
