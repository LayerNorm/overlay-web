# Gate B — official macOS binary

**Gate status:** PENDING

**Release source commit:** _unset_

**Version:** _unset_

**Decision date:** _unset_

This file is a sign-off record template. Its presence is not approval. Gate A
must already be approved for the same source lineage.

## Required artifact evidence

- [ ] Release workflow checked out the exact 40-character source SHA with no
      persisted credentials.
- [ ] Source security, dependency, licensing, tests, typecheck, and production
      build passed in the protected release job.
- [ ] Apple Developer ID signature, nested signatures, hardened runtime,
      entitlements, notarization, staple, and Gatekeeper assessment passed.
- [ ] Electron fuses, ASAR exclusions, secret/path scan, updater metadata,
      packaged native-helper hashes, SBOM, release manifest, and provenance
      passed.
- [ ] DMG and ZIP hashes match the attested candidate received by the isolated
      publish job.
- [ ] Clean Apple Silicon Mac verified install, sign-in, sign-out/revocation,
      Ask for approval, Full access warning, browser permissions, voice helpers,
      optional diagnostics revocation, update prompt, and uninstall.
- [ ] Independent reviewer completed hostile packaged-artifact and update-chain
      testing with no unresolved Critical or unaccepted High.
- [ ] Rollback, session revocation, provider kill switch, signing compromise,
      and malicious-update drills were completed and timed.

## Signatures

| Role | Name | Evidence link | Date | Decision |
| --- | --- | --- | --- | --- |
| Security owner | _unset_ | _unset_ | _unset_ | PENDING |
| Independent reviewer | _unset_ | _unset_ | _unset_ | PENDING |
| Release owner | _unset_ | _unset_ | _unset_ | PENDING |
| Operations owner | _unset_ | _unset_ | _unset_ | PENDING |
