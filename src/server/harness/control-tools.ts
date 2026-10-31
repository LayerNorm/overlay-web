import { tool } from 'ai'
import { z } from 'zod'
import { HarnessPlanValidationError, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionPorts } from './ports'

const id = z.string().min(1).max(256)
const evidenceReferenceError = 'Evidence must reference successful observations from this run.'
const completionErrors = new Set([
  'Completion requires evidence.',
  'Completion requires tool-result evidence.',
  "Completion requires tool-result evidence from this milestone's evidenceTools.",
])
const dependencyError = 'Dependencies are not complete.'
const reusedToolResultEvidenceError = 'Evidence from a tool result already supports another milestone.'
const completionHint = 'Cite tool:<id> evidence that supports this milestone, or revise the plan with harness_set_plan to mark a milestone that only reports results as answerOnly.'

function availableEvidenceIds(state: HarnessSnapshot) {
  const usedByAction = new Set(state.plan
    .filter(step => step.status === 'done' && !step.answerOnly)
    .flatMap(step => step.evidenceRefs))
  return state.evidence
    .filter(evidence => evidence.verdict !== 'failed' && !usedByAction.has(evidence.id))
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 12)
    .map(evidence => ({ id: evidence.id, source: evidence.source }))
}

function rejectedStepUpdate(error: string, state: HarnessSnapshot, stepId: string) {
  const evidenceIds = availableEvidenceIds(state)
  if (error === evidenceReferenceError) {
    return { success: false, error, availableEvidenceIds: evidenceIds }
  }
  if (completionErrors.has(error)) {
    return { success: false, error, availableEvidenceIds: evidenceIds, hint: completionHint }
  }
  if (error === reusedToolResultEvidenceError) {
    return {
      success: false,
      error,
      availableEvidenceIds: evidenceIds,
      hint: "Cite the tool result that performed this milestone's own action, or revise the plan to merge the milestones.",
    }
  }
  if (error === dependencyError) {
    const step = state.plan.find(candidate => candidate.id === stepId)
    const pendingDependencyIds = step?.dependsOn.filter(dependencyId => {
      const dependency = state.plan.find(candidate => candidate.id === dependencyId)
      return !dependency || !['done', 'skipped'].includes(dependency.status)
    }) ?? []
    return {
      success: false,
      error,
      availableEvidenceIds: evidenceIds,
      pendingDependencyIds,
      hint: 'Complete or skip these milestones first.',
    }
  }
  return undefined
}

export function createHarnessControlTools(ports: HarnessExecutionPorts) {
  return {
    harness_set_plan: tool({
      description: 'Create or revise durable milestones. Keep existing IDs; explicitly skip obsolete work. Completion requires persisted evidence.',
      inputSchema: z.object({ steps: z.array(z.object({
        id,
        title: z.string().min(1).max(500),
        dependsOn: z.array(id).max(128),
        acceptanceCriteria: z.array(z.string().min(1).max(2_000)).min(1).max(16),
        evidenceTools: z.array(id).max(8)
          .describe('Tool IDs whose successful results will prove this milestone, e.g. ["create_note"]')
          .optional(),
        requiresVerification: z.boolean().optional()
          .describe('true only when a delegated verifier will independently check this milestone'),
        answerOnly: z.boolean().optional().describe('true only for a milestone that is answering from knowledge or prior evidence with no external effect'),
      })).min(1).max(128) }),
      execute: async ({ steps }, { toolCallId }) => {
        const normalizedSteps = steps.map(step => ({
          id: step.id,
          title: step.title,
          dependsOn: step.dependsOn,
          acceptanceCriteria: step.acceptanceCriteria,
          requiresVerification: step.requiresVerification === true,
          ...(step.evidenceTools && (step.evidenceTools.length > 0 || step.answerOnly !== true)
            ? { evidenceTools: step.evidenceTools } : {}),
          ...(step.answerOnly === true ? { answerOnly: true } : {}),
        }))
        let state: HarnessSnapshot
        try {
          state = await ports.apply(`control:${toolCallId}`, { type: 'replace_plan', steps: normalizedSteps })
        } catch (error) {
          if (error instanceof HarnessPlanValidationError) {
            return {
              success: false,
              code: 'tool_validation_failure',
              error: error.message,
              hint: 'Correct the plan fields and retry. Preserve existing milestone IDs and cite only authorized evidenceTools.',
            }
          }
          throw error
        }
        return { planRevision: state.planRevision, plan: state.plan }
      },
    }),
    harness_update_step: tool({
      description: 'Update a persisted milestone using its exact ID and evidence references. Do not mark incomplete or unverified work done.',
      inputSchema: z.object({
        id,
        status: z.enum(['pending', 'running', 'blocked', 'verifying', 'done', 'skipped']),
        evidenceRefs: z.array(z.string().min(1).max(512)).max(32).optional(),
        skipReason: z.string().max(2_000).optional(),
      }),
      execute: async (input, { toolCallId }) => {
        let state: Awaited<ReturnType<HarnessExecutionPorts['apply']>>
        try {
          state = await ports.apply(`control:${toolCallId}`, { type: 'transition_step', ...input })
        } catch (error) {
          if (!(error instanceof Error)) throw error
          const verificationError = 'Independent verification of this milestone in the current plan revision is required.'
          if (error.message === verificationError) {
            return { success: false, error: verificationError,
              hint: 'Revise the plan if no independent verifier is available for this milestone.' }
          }
          if (error.message === evidenceReferenceError || completionErrors.has(error.message)
            || error.message === dependencyError || error.message === reusedToolResultEvidenceError) {
            const rejection = rejectedStepUpdate(error.message, await ports.read(), input.id)
            if (rejection) return rejection
          }
          throw error
        }
        return { planRevision: state.planRevision, step: state.plan.find(step => step.id === input.id) }
      },
    }),
    harness_read_evidence: tool({
      description: 'Retrieve persisted evidence by reference when it is no longer in the recent context.',
      inputSchema: z.object({ evidenceId: z.string().min(1).max(512) }),
      execute: async ({ evidenceId }) => ports.readEvidence(evidenceId),
    }),
    harness_report_blocker: tool({
      description: 'Pause for essential user input. Ask one concise question rather than guessing sensitive choices.',
      inputSchema: z.object({ question: z.string().min(1).max(2_000) }),
      execute: async ({ question }, { toolCallId }) => {
        const current = await ports.read()
        if (current.policy.requiresPlan && !current.plan.length) {
          return { success: false, error: 'Call harness_set_plan first; report blockers after the plan exists.' }
        }
        const state = await ports.apply(`control:${toolCallId}`, { type: 'block', blocker: { kind: 'input', question } })
        return { status: state.status, question }
      },
    }),
    harness_delegate: tool({
      description: 'Start a bounded child for an independent ready milestone. Reserve a budget and only the tools it needs. Children receive a brief, not the parent transcript.',
      inputSchema: z.object({
        stepId: id,
        goal: z.string().min(1).max(32_000),
        constraints: z.array(z.string().min(1).max(2_000)).max(32),
        allowedToolIds: z.array(id).max(512),
        maxCostMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      }),
      execute: async (input, { toolCallId }) => ports.delegate(input, toolCallId),
    }),
    harness_read_child: tool({
      description: 'Join an admitted child, waiting durably if it is still working. Start independent children before joining them. A completed result returns a parent evidenceRef for milestone completion, not independent verification.',
      inputSchema: z.object({ childRunId: id }),
      execute: async ({ childRunId }, { toolCallId }) => {
        const parent = await ports.read()
        if (!parent.children.some(child => child.id === childRunId)) throw new Error('This run did not delegate that child.')
        let child = await ports.readChild(childRunId)
        if (child.parentRunId !== parent.runId || child.rootRunId !== parent.rootRunId) throw new Error('Invalid child lineage.')
        if (!['completed', 'failed', 'cancelled'].includes(child.status)) {
          await ports.waitForChildren([childRunId])
          child = await ports.readChild(childRunId)
          if (child.parentRunId !== parent.runId || child.rootRunId !== parent.rootRunId) throw new Error('Invalid child lineage.')
        }
        const result = { status: child.status, summary: child.resultSummary ?? child.workingSummary, evidence: child.evidence, blocker: child.blocker }
        if (child.status !== 'completed') return result
        await ports.apply(`settle-child:${child.runId}:${child.revision}`, { type: 'settle_child', childRunId })
        const evidenceRef = `child-result:${toolCallId}`
        await ports.apply(`control:${toolCallId}`, { type: 'record_evidence', evidence: {
          id: evidenceRef, kind: 'tool_result', source: `harness_read_child:${child.runId}`,
          summary: JSON.stringify({ childRunId: child.runId, status: child.status, summary: result.summary,
            evidenceRefs: child.evidence.map(evidence => evidence.id) }).slice(0, 2_000),
          verdict: 'observed', createdAt: Date.now(),
        } })
        return { ...result, evidenceRef }
      },
    }),
  }
}
