# Retired hosted agent machine lifecycle

Overlay Cloud no longer provisions or wakes third-party hosted runtimes. Do not
configure, deploy, or use hosted-agent idle timers or machine recovery workflows.

Shared sandbox metering, lease settlement, provider inventory, and cleanup remain
in use for historical records and other supported workloads. Before rollout,
follow the [retirement runbook](./retire-overlay-cloud-agents.md) to inventory,
drain or owner-approved cancel, export required files, and verify settlement and
provider deletion. This document does not claim that those operations have run.
