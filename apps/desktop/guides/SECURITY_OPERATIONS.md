# Security operations

This runbook applies to Overlay Desktop source, official macOS artifacts, the
canonical Overlay Server, provider accounts, and the release pipeline.

## Ownership and response targets

LayerNorm's security owner is the incident commander until responsibility is
explicitly transferred. Repository, server, billing/provider, and release
owners must have named primary and backup contacts in the private operations
system.

Target response times:

| Severity | Acknowledge | Triage and owner | Containment target |
| --- | --- | --- | --- |
| Critical | 4 hours | 8 hours | 24 hours |
| High | 1 business day | 2 business days | 3 business days |
| Medium | 3 business days | 5 business days | Planned milestone |
| Low | 5 business days | 10 business days | Backlog with owner |

These are targets, not disclosure promises. Communicate honestly when scope,
coordination, or user safety requires more time.

## Intake

- GitHub Private Vulnerability Reporting is the primary source-repository
  channel.
- `divyansh@layernorm.co` is the fallback in `SECURITY.md`.
- Test both paths before Gate A and quarterly thereafter using a harmless
  synthetic report.
- Move any accidental public disclosure to the private incident record
  immediately. Do not copy secrets or customer data into public issues.

## Monitoring

Operations must page or create a reviewed alert for:

- owner-funded provider spend rate, daily totals, and hard-cap/kill-switch
  activation;
- reservation creation/finalization mismatches, stale reservations, replay and
  idempotency conflicts;
- authentication failures, refresh abuse, suspicious account creation,
  session-transfer failures, and mass revocation;
- SSRF/private-network denials, privileged IPC denials, unusual Full access
  enablement, and approval rejection spikes;
- Sentry/diagnostic redaction failures and unexpected telemetry volume;
- dependency, secret-scanning, push-protection, branch-protection, and
  CODEOWNERS bypass alerts;
- signing/notarization failures, provenance mismatch, updater errors,
  downgrade/replay attempts, and release hash mismatch.

Alerts must contain identifiers sufficient to investigate without including
tokens, email addresses, raw prompts/documents, filesystem paths, request
bodies, provider responses, or integration content.

## Incident playbooks

### Provider credential or billing runaway

1. Activate the server-side hosted-provider kill switch and provider hard cap.
2. Revoke and rotate the affected provider credential; never distribute the
   replacement to a client.
3. Stop new paid reservations and reconcile every open reservation against
   trusted provider usage.
4. Inspect account/model/route/idempotency patterns and preserve redacted
   evidence.
5. Restore one operation class at a time only after negative tests pass.

### Session or auth compromise

1. Disable the affected native/session-transfer route if exploitation is active.
2. Revoke affected sessions and refresh tokens; rotate session-transfer and
   cookie-encryption keys using the documented overlap window.
3. Confirm the desktop cannot recover legacy/plaintext state and force sign-in
   where needed.
4. Audit account changes, provider work, integrations, and billing during the
   exposure window.

### Signing, CI, or release credential compromise

1. Keep release and publish jobs frozen; disable updater publication.
2. Revoke the GitHub App credential, Apple signing/notarization credential, and
   any affected automation token.
3. Quarantine artifacts and compare public hashes/provenance with the protected
   build evidence.
4. Rotate credentials in isolated protected environments and rebuild from a
   reviewed source commit.

### Malicious or incorrect update

1. Remove or disable the update metadata and release artifact at the distribution
   point; do not silently replace an artifact under an existing version.
2. Freeze all releases, preserve evidence, and determine affected versions.
3. Revoke signing material if authenticity may be compromised.
4. Publish a clear advisory and recovery version through a new signed,
   notarized, attested release after Gate B is repeated.

## Release cadence

Run source gates on every pull request. Repeat Gate A after changes to auth,
billing, IPC, host permissions, browser/network policy, server contracts, or
repository history/export policy. Repeat Gate B for every official binary and
after any native helper, dependency, entitlement, signing, updater, or workflow
change.

Review dependencies continuously, test vulnerability intake quarterly, rehearse
the five incident classes at least twice yearly, and commission an independent
review annually or after a material trust-boundary redesign.
