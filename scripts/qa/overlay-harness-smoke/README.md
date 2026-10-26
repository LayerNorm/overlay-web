# Overlay Harness standalone proof

This fixture tests `WorkflowAgent` before the production migration. It does not
change the application's runtime or deploy Convex. It pins Workflow 5.1.0 and
the compatible Vitest plugin separately because the application still uses
Workflow 4 while `@ai-sdk/workflow@2.0.24` requires Workflow 5.

## Run

From this directory:

```sh
npm ci --workspaces=false --no-audit --no-fund
npm run typecheck
npm test
OVERLAY_HARNESS_LIVE=1 npm test
```

Bind `AI_GATEWAY_API_KEY` through your secret manager for the live command. Do
not put it in a file or a workflow argument. The no-key test checks serialization;
live scenarios are skipped unless explicitly enabled. Local npm configuration
uses legacy peer resolution to avoid npm 10's Arborist optional-peer crash.
Direct SDK/runtime versions are pinned and tested together.

The default route is `nvidia/nemotron-3.5-lightning-free` on `nvidia`. Each call
checks the live endpoint catalog for zero pricing and tools, restricts the provider,
and checks the actual route and zero-cost receipt. No paid fallback is configured.
Missing pricing or unsafe receipts fail closed. These are synthetic invoices:
there is no personal data, real payment, or external write. A changed provider
price between preflight and execution remains an upstream race; receipts detect
that condition after the call rather than pretending preflight guarantees it.

## What it proves

- A live model reviews 24 records, produces the independent golden total of
  31,740 cents, and completes an evidence-backed plan beyond 20 model calls.
- `isLoopFinished()` removes the step cap. A controlled no-tool response at
  call eight is a fault injection, not the production task termination policy.
  An outer controller rebuilds working context and continues unfinished work.
- `prepareStep.system` supplies authoritative working state. The constructor's
  `instructions` property is not a supported per-step override in the pinned SDK.
  Tools with unmet prerequisites are not advertised; executors still validate
  their inputs. Pending reads return the pending record on retries. State writes
  are serialized within each child and atomically replaced for readers.
- Incorrect model classifications cannot pass completion: an independent
  task-specific verifier checks structured source fields, and the controller
  requires that verification. Source notes are untrusted.
- Missing input causes a durable hook wait. A separately retrieved run resumes
  after the answer, rather than starting the task over.
- Two bounded child contexts run concurrently inside the parent workflow,
  share a deadline, and return isolated results that the parent joins.
- A custom serializable language-model reference crosses the SDK's durable
  boundary. Only the model ID is serialized; provider credentials are resolved
  inside a step. Tests scan local workflow history and artifacts for the bound key.
- Receipts capture input, output, reasoning, cache reads/writes and model cost.
  No cache savings are assumed. All model receipts must be verified zero-cost.

## Limits

The JSON artifact store is a test fixture, not production storage or a concurrent
transaction protocol. Production requires scoped storage, revision checks,
capability and approval enforcement, root spend reservations, artifact/evidence
validation, resource locks and cancellation. Child contexts here are durable
branches of one workflow, not separately scheduled child jobs. Hook replay is
tested; an operating-system crash/restart is not yet fault-injected. The secure
model-reference test uses Gateway credentials, not live paid BYOK providers.

The fixed 18-minute smoke deadline is a test safety budget, never successful task
completion. Three unchanged model cycles trigger a recovery checkpoint, not
task completion; two unchanged continuation attempts fail explicitly. Retryable
provider errors get at most two SDK retries on the same verified-free route.
Results and local Workflow files are gitignored. This proof is not a claim that
the application migration or end-to-end browser QA is complete.
