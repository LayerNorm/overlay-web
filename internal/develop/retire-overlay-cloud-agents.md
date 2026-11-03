# Retiring hosted Overlay Cloud agent runtimes

This runbook is a required deployment gate. No production inventory or drain is established as completed by this code change.

Before rollout:

1. Inventory every `overlay_cloud` environment and binding, active sandbox lease, provision record, queued/active remote run, and provider machine. Reconcile identifiers across web, Convex, billing, and the provider.
2. Stop new hosted-runtime admission. Drain active runs; otherwise obtain owner-approved cancellation. Preserve terminal cancellation and usage settlement.
3. Export user-owned data before destroying any machine. Revoke environment access and let the existing lease reaper perform provider cleanup; verify deletion with provider evidence and resolve failures. A released lease alone does not prove charges stopped.
4. Retain historical environments, bindings, provisions, artifacts, and audit records. Do not convert legacy agents into native Overlay agents.
5. Deploy the reviewed web revision first. Deploy only its matching Convex revision after the web is live and verified; do not deploy Convex ahead of web or from another revision.
6. Confirm the Agent Host package/protocol compatibility for user-owned BYOM hosts. Host and protocol releases must be lockstep; do not use a legacy Cloud host/image to restore hosted execution.
7. Rollback cannot restore runnable hosted-runtime code or safely resume machines; use a forward fix.

Do not run destructive cleanup or claim completion without the recorded owner approval and provider verification.
