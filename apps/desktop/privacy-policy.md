# Overlay Desktop Data-Handling Notice

**Last reviewed:** July 24, 2026

This document describes the data flows implemented by the open-source Overlay
Desktop client. It does not replace the privacy policy presented by the
operator of the Overlay Server you choose. Overlay Cloud's current legal
privacy policy is presented by LayerNorm Inc. through the official service.
Self-hosted operators are responsible for their own disclosures, retention, and
legal obligations.

## Summary

- Overlay Desktop supports both local and server-backed features.
- Data used by a local-only feature stays on the Mac unless the user exports it
  or invokes a networked feature.
- Hosted chat, sync, account, integration, storage, and cloud transcription
  features send the content required to perform that feature to the selected
  Overlay Server and its configured processors.
- Authentication, hosted model policy, billing, entitlements, and hosted usage
  accounting are server-authoritative.
- User-owned API-key flows may send content directly from the Mac to the
  selected third-party provider.
- Optional diagnostics are off by default.
- The desktop app does not sell personal information.

## Data stored on the Mac

Depending on enabled features, the app stores local settings, notes, cached or
local conversations, downloaded speech models, local files and indexes,
browser profiles, bounded security logs, and session material protected by
macOS facilities.

The app also stores the selected Overlay Server profile and the desktop chat
operation mode. Ask for approval is the default. Full access remains a local
host permission and is not synced as a server authorization grant.

Deleting the app does not necessarily delete its Application Support, Keychain,
or downloaded model data. Users should use product deletion controls and macOS
data-management tools as appropriate.

## Data sent to an Overlay Server

The selected server may receive:

- authentication and account identifiers;
- chat prompts, attachments, tool inputs, model outputs, and conversation
  records needed for cloud chat and sync;
- notes, files, memory, project, and knowledge data when a cloud-backed feature
  or migration is enabled;
- audio or transcription inputs when cloud transcription is selected;
- integration requests and data needed to perform an enabled integration;
- model choice, reservation, entitlement, and usage records needed to enforce
  policy and billing;
- security and service metadata such as timestamps, IP address, app version,
  request identifiers, and failure codes.

The server may pass required content to configured model, storage,
authentication, integration, payment, hosting, or monitoring providers. The
server operator's policy governs those processors and retention.

The desktop binds its session and approval context to the chosen deployment.
A self-hosted failure must not silently send the request to Overlay Cloud.

## User-owned provider credentials

When a user explicitly configures a supported BYOK flow, the credential remains
under the user's control on the Mac and requests may go directly to that
provider. The provider receives the content required for the request and its
own terms apply.

LayerNorm-funded or operator-funded provider credentials are never distributed
to the desktop. Hosted work using those credentials is mediated,
authorized, and accounted by the selected server.

## Local and cloud transcription

Local transcription uses downloaded CoreML models and one-shot native helpers
on the Mac. Audio is not sent to an Overlay Server for a successfully local
operation.

Cloud transcription sends audio to the selected server or provider as required
by that mode. Product UI must identify the selected mode; local fallback must
not be described as local if a network request is made.

## Optional diagnostics

Share Anonymous Diagnostics is off by default. When enabled, the app may send
redacted crash and aggregate feature-count events. It must not send prompts,
outputs, notes, audio, filenames, document contents, browsing history, URLs,
tool bodies, authorization values, API keys, raw user identifiers, or raw
filesystem paths.

The app uses an on-device pseudonymous analytics identifier rather than the raw
account identifier. Disabling diagnostics stops new collection and deletes
locally retained diagnostic counters. Local security logs use redaction,
owner-only permissions, bounded size, and a 14-day retention limit.

## Browser and agent operations

Interactive browser data is stored in a different session partition from
agent-browser data. Agent sessions do not inherit interactive cookies. Browser
content may still be processed locally or sent to the selected server/model
when the user invokes an agent operation.

Ask for approval and Full access control eligible host operations, not content
collection. Full access increases host-execution risk but does not enable
optional diagnostics.

## Payments

Payment card data is handled by the configured payment processor, not stored as
raw card data by the desktop app. The server may retain customer, subscription,
entitlement, invoice, and transaction identifiers needed to provide paid
features and support.

## User choices

Users can:

- leave optional diagnostics disabled;
- use Ask for approval rather than Full access;
- select local transcription where available;
- remove downloaded models and local app data;
- disconnect integrations;
- use a compatible self-hosted Overlay Server and review that operator's
  policies;
- request account or hosted-data access/deletion from the server operator.

## Security and reporting

No storage or transmission method is perfectly secure. Report security issues
privately through `SECURITY.md`; do not include real customer data or
production credentials in a report.

For questions about LayerNorm's official service, contact
divyansh@layernorm.co. For a self-hosted deployment, contact that deployment's
operator.
