# Maintainer Responsibilities

LayerNorm Inc. owns final review for security-sensitive desktop areas.

Changes to authentication, billing, IPC, host execution, browser isolation,
network policy, telemetry, native helpers, signing, updates, or release
workflows require maintainer review. Dependency updates that affect those areas
must include targeted regression evidence.

Repository administrators must enable:

- required pull-request reviews and status checks;
- dismissal of stale approvals after security-sensitive changes;
- maintainer two-factor authentication;
- secret scanning and push protection;
- Dependabot security updates;
- private vulnerability reporting;
- protected `release-macos` and `release-publish` environments;
- no direct release from forked pull-request code.

GitHub-hosted settings cannot be proven from repository files. The release owner
must record screenshots or exported settings during Gate B review.
