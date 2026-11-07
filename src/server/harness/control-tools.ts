import { tool } from 'ai'
import { z } from 'zod'
import { HarnessPlanValidationError, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { encodeRunQuestions, runQuestionIssue, type RunQuestion } from '@/shared/agents/run-questions'
import type { HarnessArtifactReadResult, HarnessExecutionPorts } from './ports'
import { HARNESS_STEP_VALIDATION, isHarnessStepValidation } from './step-validation'

const id = z.string().min(1).max(256)

const runQuestion = z.object({
  prompt: z.string().min(1).max(300).describe('The question, written for the person reading it'),
  description: z.string().max(300).optional().describe('Why it matters, or what the answer changes'),
  choices: z.array(z.object({
    label: z.string().min(1).max(80),
    description: z.string().max(160).optional(),
  })).max(6).optional().describe('Likely answers. Offer these whenever the options are knowable'),
  multiple: z.boolean().optional().describe('true when more than one choice can apply'),
  allowCustomAnswer: z.boolean().optional().describe('true to also let the person write their own answer'),
  optional: z.boolean().optional().describe('true when the person can skip this and you can continue without it'),
})

function artifactIdentity(metadata: HarnessArtifactReadResult['metadata']): string {
  const resource = metadata.resource
    ? `; resource ${metadata.resource.id}${metadata.resource.revision ? ` revision ${metadata.resource.revision}` : ''}${metadata.resource.operation ? ` operation ${metadata.resource.operation}` : ''}${metadata.resource.page ? ` page ${metadata.resource.page}` : ''}`
    : ''
  return `artifact ${metadata.artifactId}; ${metadata.toolName} call ${metadata.toolCallId}${resource}`
}

function rejectedStepUpdate(error: string, state: HarnessSnapshot, stepId: string) {
  if (error !== HARNESS_STEP_VALIDATION.dependencies) return { success: false, error }
  const step = state.plan.find(candidate => candidate.id === stepId)
  const pendingDependencyIds = step?.dependsOn.filter(dependencyId => {
    const dependency = state.plan.find(candidate => candidate.id === dependencyId)
    return !dependency || !['done', 'skipped'].includes(dependency.status)
  }) ?? []
  return { success: false, error, pendingDependencyIds, hint: 'Complete or skip these steps first.' }
}

export function createHarnessControlTools(ports: HarnessExecutionPorts) {
  return {
    harness_set_plan: tool({
      description: 'Create or revise a plan for a long task that needs structure. The person sees these steps as your progress, so write short, plain titles. Keep existing IDs and skip steps that no longer apply.',
      inputSchema: z.object({ steps: z.array(z.object({
        id,
        title: z.string().min(1).max(500),
        dependsOn: z.array(id).max(128).optional(),
      })).min(1).max(128) }),
      execute: async ({ steps }, { toolCallId }) => {
        const normalizedSteps = steps.map(step => ({
          id: step.id,
          title: step.title,
          dependsOn: step.dependsOn ?? [],
          acceptanceCriteria: [step.title],
          requiresVerification: false,
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
              hint: 'Correct the plan and retry. Keep existing step IDs.',
            }
          }
          throw error
        }
        return { planRevision: state.planRevision, plan: state.plan }
      },
    }),
    harness_update_step: tool({
      description: 'Set a plan step to running when you start it and done when you finish it. Marking a step done means the work is finished.',
      inputSchema: z.object({
        id,
        status: z.enum(['pending', 'running', 'blocked', 'done', 'skipped']),
        skipReason: z.string().max(2_000).optional(),
      }),
      execute: async (input, { toolCallId }) => {
        let state: Awaited<ReturnType<HarnessExecutionPorts['apply']>>
        try {
          state = await ports.apply(`control:${toolCallId}`, { type: 'transition_step', ...input })
        } catch (error) {
          if (!(error instanceof Error) || !isHarnessStepValidation(error.message)) throw error
          return rejectedStepUpdate(error.message, await ports.read(), input.id)
        }
        return { planRevision: state.planRevision, step: state.plan.find(step => step.id === input.id) }
      },
    }),
    harness_read_evidence: tool({
      description: 'Read a persisted observation by evidence ID, or list a bounded chronological page of observation IDs and outcomes. Omitted or truncated content is not proof of absence.',
      inputSchema: z.object({
        evidenceId: z.string().min(1).max(512).optional(),
        cursor: z.string().max(512).optional(),
        limit: z.number().int().min(1).max(32).optional(),
      }),
      execute: async ({ evidenceId, cursor, limit }) => ports.readEvidence(evidenceId ?? '', cursor, limit),
    }),
    harness_read_artifact: tool({
      description: 'Reopen a private tool-result artifact using a bounded text range or a selected media-part index. Access is reauthorized against the original source tool. ',
      inputSchema: z.object({
        artifactId: z.string().min(67).max(67).regex(/^ha_[a-f0-9]{64}$/),
        start: z.number().int().nonnegative().optional(),
        end: z.number().int().nonnegative().optional(),
        mediaPart: z.number().int().nonnegative().optional(),
      }).strict().refine(input => {
        if (input.mediaPart !== undefined) return input.start === undefined && input.end === undefined
        return input.end === undefined || input.start === undefined || input.end >= input.start
      }),
      execute: async (input, { toolCallId }) => {
        if (!ports.readArtifact) throw new Error('Harness artifact reads are unavailable.')
        const output = await ports.readArtifact(input)
        const selection = output.kind === 'text'
          ? `Incomplete text excerpt, range ${input.start ?? 0}:${input.end ?? 'bounded default'}:\n${output.text.slice(0, 1_200)}`
          : `Opened media part ${output.metadata.mediaPart} of ${output.metadata.mediaPartCount} (${output.mediaType}); no semantic content is certified by this observation.`
        await ports.apply(`artifact-read:${toolCallId}`, { type: 'record_evidence', evidence: {
          id: `tool:${toolCallId}`, kind: 'tool_result', source: 'harness_read_artifact',
          resource: output.metadata.resource,
          summary: `${artifactIdentity(output.metadata)}\n${selection}`.slice(0, 2_000),
          verdict: 'observed', createdAt: Date.now(),
        } })
        return output
      },
      toModelOutput: ({ output }) => output.kind === 'media'
        ? {
            type: 'content',
            value: [
              { type: 'text', text: `[Incomplete media selection; ${artifactIdentity(output.metadata)}; selected part ${output.metadata.mediaPart} of ${output.metadata.mediaPartCount}.]` },
              { type: 'file', data: { type: 'data', data: output.data }, mediaType: output.mediaType },
            ],
          }
        : { type: 'text', value: `[Incomplete artifact excerpt; ${artifactIdentity(output.metadata)}]\n${output.text}` },
    }),
    harness_report_blocker: tool({
      description: 'Pause and ask the person when you need a decision only they can make. Ask real questions they can answer without knowing how you work, and offer choices whenever you can. Never use this to report internal problems or to end your turn.',
      inputSchema: z.object({ questions: z.array(runQuestion).min(1).max(4) }),
      execute: async ({ questions }, { toolCallId }) => {
        const asked = questions as RunQuestion[]
        const issue = runQuestionIssue(asked)
        if (issue) return { success: false, error: issue }
        const encoded = encodeRunQuestions(asked)
        if (encoded.length > 2_000) {
          return { success: false, error: 'These questions are too long. Shorten them or ask fewer.' }
        }
        const state = await ports.apply(`control:${toolCallId}`, { type: 'block', blocker: { kind: 'input', question: encoded } })
        return { status: state.status, questions: asked }
      },
    }),
    harness_delegate: tool({
      description: 'Start a bounded child for an independent ready plan step. Legacy runs require a spend allocation; v2 runs use their configured payer without a child lifetime cap. Grant only the tools it needs. Children receive a brief, not the parent transcript.',
      inputSchema: z.object({
        stepId: id,
        goal: z.string().min(1).max(32_000),
        constraints: z.array(z.string().min(1).max(2_000)).max(32),
        allowedToolIds: z.array(id).max(512),
        maxCostMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      }),
      execute: async (input, { toolCallId }) => {
        const parent = await ports.read()
        if (parent.policy.executionPolicyVersion !== 2 && input.maxCostMicros === undefined) {
          return { success: false, error: 'Specify a child spend allocation for this legacy run.' }
        }
        return ports.delegate({
          ...input,
          maxCostMicros: parent.policy.executionPolicyVersion === 2 ? 0 : input.maxCostMicros!,
        }, toolCallId)
      },
    }),
    harness_read_child: tool({
      description: 'Join an admitted child, waiting durably if it is still working. Start independent children before joining them. ',
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
        const assignment = await ports.readAssignmentResult?.(childRunId)
        const result = { status: assignment?.runStatus ?? child.status, summary: assignment?.summary ?? child.resultSummary ?? child.workingSummary,
          evidence: child.evidence, blocker: assignment?.blocker ?? child.blocker,
          ...(assignment ? { assignment, reply: assignment.reply, publicationPending: assignment.state === 'publication_pending' } : {}) }
        if (assignment && assignment.state !== 'ready') return result
        if (result.status !== 'completed') return result
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
