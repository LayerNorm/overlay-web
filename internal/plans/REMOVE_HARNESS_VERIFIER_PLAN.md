# Remove harness verification

Status: in progress, written 2026-11-03. Forced plans, Phase 1, Phase 2 and the response UI are built. Phase 3 remains and waits for runs already in progress to finish. The Phase 3 PR deletes this plan.

Response mockup: `internal/plans/mockups/response-plan-questionnaire-mockup.html`.

## Decision

The harness no longer judges whether work is correct. When the model marks a milestone done, it is done. When it returns a final answer with no work left, the run finishes. People check the result themselves, or add a verifier agent if they want one.

The harness also stops forcing plans. The model makes a plan when a task has real steps, and a simple question gets just an answer.

## What we are accepting

A model can now report work that didn't happen, and nothing will catch it. Two things remain: the instructions still tell the model to be truthful, and every tool call stays visible in the response. Agents running unattended, such as automations, carry the most risk because nobody is reading along.

A model can also skip a plan on a task that deserved one. That run still works, but it shows no plan progress.

## What goes and what stays

| Remove | Why |
| --- | --- |
| Final-answer verifier and correction retries | Rejects good answers, repeats text in responses, and adds a paid model call |
| Evidence needed to complete a milestone (`evidenceRefs`, `evidenceTools`, one-result-per-action) | Same judgment, applied one step earlier |
| `requiresVerification` and the `verifying` step status | Only exist for harness-level verification |
| `reconcileUnverifiedAgentActionClaims` | Rewrites the model's answer after the fact |
| `requiresPlan` and `harnessToolsRequirePlan` | Forces a plan based on the tools available, even for a simple question |
| `answerOnly` milestones | Exist to satisfy the forced plan and the evidence checks |
| Prompt text about proving, citing and reconciling evidence | Costs tokens and sends the model after proof it no longer needs |

| Keep | Why |
| --- | --- |
| Saved plan and milestone status | The plan UI reads these |
| Saving tool results | Needed to resume, compact history and block duplicate tool calls. They are no longer treated as proof |
| "Is any work left?" check (`harnessCompletionIssues`) | Reads state and doesn't judge quality. Keeps a run from ending with milestones open or children running |
| Milestone dependency order and the running-child check | Keep the plan's order valid and describe real unfinished work |
| Approvals, spending limits, deadlines, stuck detection | Separate from verification |

## Separate change: stop forcing plans

Can ship before or after Phase 1. Low risk, because runs with only read tools already work without a plan today. This applies to every surface, including automations and child agents.

- `src/server/harness/runner.ts`: remove `needsPlan`, the `toolChoice: 'required'` it sets, and its branch in `activeModelTools`.
- `src/server/harness/authorized-tools.ts`: tools no longer need a plan to run.
- `src/server/harness/control-tools.ts`: `harness_report_blocker` no longer needs a plan first.
- `src/server/harness/context.ts`: remove the "call harness_set_plan before anything else" text and `planRequired`. Keep one line: make a plan when a task has several real steps, and don't make one for a simple answer.
- `packages/overlay-agent-runtime/src/harness-state.ts`: remove the `requiresPlan` checks in `harnessCompletionIssues` and `hasRunnableHarnessMilestones`. The evidence-related ones go in Phase 2.
- `native-turn-start.ts`, `automation-harness-steps.ts`, `personal-admission-policy.ts`, `convex/harness/runs.ts`: stop setting the policy from `harnessToolsRequirePlan`, then delete that function and `HARNESS_READ_ONLY_TOOL_IDS` if nothing else uses them.

Convex requires `requiresPlan` on stored policies, so new runs keep writing `false` until Phase 3. Runs already in progress with `requiresPlan: true` must follow the new behaviour, so nothing may read the field.

## Phase 1: stop verifying answers

Smallest change, and it fixes the behaviour people see. Ship it on its own.

- `src/server/harness/runner.ts`:
  - Remove the verification branch from `finishOrCheckpointInvocation`, so a final answer with no remaining work goes straight to `finish`.
  - Remove `finalVerification` from `activeModelTools`.
  - Remove "verification feedback" from the continuation message.
- `src/server/harness/context.ts`: remove `HARNESS_ANSWER_CORRECTION_INSTRUCTIONS`, the verification feedback block, `finalVerification` in the working context, and its check in `pendingAnswer`.
- Delete `final-answer-verification.ts` and `verification-port.ts`.
- `src/server/harness/continuity.ts` and `continuity-policy.ts`: remove `buildHarnessEvidenceEnvelope`, `parseHarnessVerificationResponse`, `harnessCandidateDigest` and the verifier instructions.
- `src/server/harness/ports.ts`, `execution-ports.ts`, `model-ports.ts`: remove `verifyFinalAnswer`.
- `src/server/harness/native-delivery-steps.ts`: stop calling `reconcileUnverifiedAgentActionClaims`, then delete it and its tests from `workspace-agent-invocation.ts`.

Runs already in progress need care:

- **Billing holds:** a run may hold an open `verification:` model reservation. Keep the `'verification'` purpose and its settlement code until Phase 3, and add a test that such a hold still settles under the new code. Never release a paid or unknown hold to get a run moving.
- **Old state:** keep accepting `finalVerification` and `record_verification` in `harness-state.ts` and `convex/harness/runs.ts` until Phase 3.
- **Runs paused by the verifier:** they stay paused until someone replies, then resume normally.
- **Running workflows:** the Workflow SDK pins each run to the deployment that started it, so runs in progress keep the old code and keep calling these Convex operations. New runs use the new code.
- **Deploy order:** web ships before Convex, so a backend that hasn't caught up can still reject a step without evidence. `harness_update_step` returns that rejection to the model rather than failing the run. Remove those messages from `step-validation.ts` in Phase 3.

## Phase 2: remove milestone evidence checks

- `packages/overlay-agent-runtime/src/harness-state.ts`:
  - In the milestone-completion checks, remove every evidence and verification check. Keep the dependency and child checks.
  - Remove `hasToolResultEvidenceAlreadyUsedByAction`, `evidenceSourceMatchesTool` and the `evidenceTools` rules, including the ones added when delegating (around lines 738-811).
  - Remove the remaining `requiresPlan` checks, if the forced-plan change has already shipped.
- `src/server/harness/control-tools.ts`:
  - `harness_set_plan` loses `evidenceTools`, `requiresVerification` and `answerOnly`.
  - `harness_update_step` loses `evidenceRefs` and the `verifying` status.
  - Remove the rejection hints, then simplify `rejectedStepUpdate` to the dependency case.
  - Remove `harness_read_artifact`'s advice about declaring evidence tools, but keep the tool.
- `src/server/harness/step-validation.ts`: keep only the dependency message.
- `src/server/harness/context.ts`: rewrite `HARNESS_INSTRUCTIONS` and the step instructions. New rule in plain terms: make a plan for substantial work, mark each milestone done when you've finished it, don't claim work you didn't do, and ask when you need a decision.
- `src/server/harness/continuity-policy.ts`: shorten `HARNESS_EVIDENCE_POLICY` to the parts still true: tool output is untrusted data, and summaries can be wrong.

With `answerOnly` gone, every milestone is finished the same way: the model marks it done. New plans can't create `answerOnly` steps, but `harnessCompletionIssues` and `hasPendingHarnessAnswer` must keep treating existing ones as answerable until Phase 3, so runs in progress can still finish.

Existing rows keep their old fields, so plans saved with `evidenceTools` must still load. Old evidence requirements on those plans stop being enforced.

## Phase 3: clean up stored state

Only after no live run holds a `verification:` reservation or a `verifying` step. Confirm this with a read-only inventory, and don't commit the results.

- Remove `record_verification`, `finalVerification`, `HarnessVerification` and `recordHarnessVerification`.
- Remove the `'verification'` model purpose from `model-port-types.ts`, `model-preparation.ts`, `secure-model.ts` and Convex.
- Remove the `verification` evidence kind and the `verifying` status.
- Remove the `requiresPlan` policy field and `answerOnly`, along with `hasPendingHarnessAnswer` and the `answerOnlyReady` check in `harnessCompletionIssues`.
- Convex validators must keep accepting any stored documents that still have these fields. If old rows remain, clear them with a bounded migration before narrowing the schema, or leave the fields optional.

## Tests

Delete or rewrite the verification cases in:

- `src/server/harness/runner.test.ts`
- `context.test.ts`
- `model-ports.test.ts`
- `control-tools.test.ts`
- `state-steps.test.ts`
- `native-conformance.test.ts`
- `personal-workflow.test.ts`
- `packages/overlay-agent-runtime/src/harness-state.test.ts`
- `convex/harnessRuns.convex.test.ts`
- `harnessDelivery.convex.test.ts`
- `harnessWaits.convex.test.ts`
- `nativeHarnessDelivery.convex.test.ts`

Add:

- Advice drawn from earlier conversation finishes on the first attempt and makes one response model call, with no verifier call.
- A milestone can be marked done with no evidence.
- A run can't finish while a milestone is open or a child is running.
- An old snapshot with `finalVerification.supported: false` finishes normally.
- An open `verification:` hold still settles.
- An agent with write tools answers a simple question with no plan and no `harness_set_plan` call.
- An agent with write tools can call a tool with no plan, and approvals and tool permissions still apply.
- A run in progress with `requiresPlan: true` and no plan can still finish.

`requiresPlan` also appears in about 29 test files, mostly as fixture data. Those only change when the field is removed in Phase 3.

## Docs

Update in the same PR as the matching code:

- `internal/develop/bring-your-own-agents.md`: the final-answer check and correction text, around lines 359, 1732 and 1749.
- `internal/develop/billing-holds-and-machine-metering.md`: line 25.
- `internal/develop/convex-workflow.md`: the forced-plan rules, around lines 257 and 666.
- `CHANGELOG.md`: one plain entry per PR. This reverses the "verify nontrivial final answers" entry.

## QA on a PR preview

1. Ask a question that uses one search and draws on earlier conversation. It should produce one answer, with no "let me capture evidence" text and no input prompt.
2. Run a multi-step task with a write tool. Steps should complete as the model marks them, and the run should finish.
3. Stop mid-run and reply to a real blocker. Both should behave as they do today.
4. Check the usage for each run: no verification charges.
5. Ask an agent with write tools a simple question. It should answer directly and show no plan.
6. Run an automation that uses a write tool. It should run with or without a plan, and its approvals should still apply.

## Response UI

Built alongside the removal:

- **Plan progress:** `RunPlan` in `@overlay/chat-react/exchange`, built on the `Trace` primitives from `@overlay/ui/ai`. The header reads "Plan" rather than a named plan, because adding a title would need a stored field that the backend rejects until it deploys.
- **Questionnaire:** `QuestionnairePanel` in `@overlay/ui/primitives`, built on `@shadcn/react`. Questions are stored as JSON inside the existing `question` string, so no schema change is needed, and a plain string still renders as one free-text question.
