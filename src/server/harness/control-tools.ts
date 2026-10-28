import { tool } from 'ai'
import { z } from 'zod'
import type { HarnessExecutionPorts } from './ports'

const id = z.string().min(1).max(256)

export function createHarnessControlTools(ports: HarnessExecutionPorts) {
  return {
    harness_set_plan: tool({
      description: 'Create or revise durable milestones. Keep existing IDs; explicitly skip obsolete work. Completion requires persisted evidence.',
      inputSchema: z.object({ steps: z.array(z.object({
        id,
        title: z.string().min(1).max(500),
        dependsOn: z.array(id).max(128),
        acceptanceCriteria: z.array(z.string().min(1).max(2_000)).min(1).max(16),
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
          ...(step.answerOnly === true ? { answerOnly: true } : {}),
        }))
        const state = await ports.apply(`control:${toolCallId}`, { type: 'replace_plan', steps: normalizedSteps })
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
          if (error.message === 'Evidence must reference successful observations from this run.') {
            const availableEvidenceIds = (await ports.read()).evidence
              .filter(evidence => evidence.verdict !== 'failed')
              .sort((left, right) => right.createdAt - left.createdAt)
              .slice(0, 12)
              .map(evidence => evidence.id)
            return { success: false, error: error.message, availableEvidenceIds }
          }
          const verificationError = 'Independent verification of this milestone in the current plan revision is required.'
          if (error.message === verificationError) {
            return { success: false, error: verificationError,
              hint: 'Revise the plan if no independent verifier is available for this milestone.' }
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
