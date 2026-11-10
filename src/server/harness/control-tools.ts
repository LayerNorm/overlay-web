import { tool } from 'ai'
import { z } from 'zod'
import { HarnessPlanValidationError, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { encodeRunQuestions, runQuestionIssue, type RunQuestion } from '@/shared/agents/run-questions'
import type { HarnessArtifactReadResult, HarnessExecutionPorts } from './ports'
import { HARNESS_STEP_VALIDATION, isHarnessStepValidation } from './step-validation'

const id = z.string().min(1).max(256)

const childReadInput = z.object({ childRunId: id.optional(), assignmentId: id.optional() })
  .refine(input => Boolean(input.childRunId) !== Boolean(input.assignmentId), 'Pass exactly one of childRunId or assignmentId.')

async function resolveChildRead(ports: HarnessExecutionPorts, input: z.infer<typeof childReadInput>) {
  if (Boolean(input.childRunId) === Boolean(input.assignmentId)) return { feedback: {
    success: false, error: 'Pass exactly one of childRunId or assignmentId.', hint: 'Use assignmentId when recovering an assignment without its child handle.',
  } }
  if (input.childRunId) return { childRunId: input.childRunId }
  const assignment = await ports.readAssignmentChild?.(input.assignmentId!)
  if (!assignment) return { feedback: { success: false, error: 'Assignment is unavailable to this run.', hint: 'Use an assignmentId from your authorized assignment obligations.' } }
  if (assignment.childRunId) return { childRunId: assignment.childRunId }
  if (assignment.launchPending) return { feedback: { status: 'launch_pending', ...assignment,
    hint: 'Read again shortly using assignmentId. Launch is pending; this does not mean no child will launch. Do not guess a child ID.' } }
  return { feedback: { status: 'launch_unavailable', ...assignment, hint: 'No child is bound and launch is not pending. Review the assignment before resolving it.' } }
}

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
  if (error === HARNESS_STEP_VALIDATION.unknownStep) {
    return { success: false, error, currentStepIds: state.plan.map(step => step.id), hint: state.plan.length
      ? 'Use an existing step ID, or revise the plan with harness_set_plan before updating it.'
      : 'There is no plan to update. Continue the requested work or answer directly if it is complete. Create a plan only if the remaining work needs one.' }
  }
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
      description: 'Update an existing plan step by its ID: running when you start it, done when finished. Marking a step done means the work is finished. Simple replies and resuming after user input do not require creating or updating a plan.',
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
      description: 'Start a child for an independent ready plan step. It is paid like this run, from the same workspace budget. Grant only the tools it needs. Children receive a brief, not the parent transcript.',
      inputSchema: z.object({
        stepId: id,
        goal: z.string().min(1).max(32_000),
        constraints: z.array(z.string().min(1).max(2_000)).max(32),
        allowedToolIds: z.array(id).max(512),
      }),
      execute: async (input, { toolCallId }) => ports.delegate(input, toolCallId),
    }),
    harness_read_child: tool({
      description: 'Read an assignment by assignmentId, or join an admitted child by childRunId. Pass exactly one. Bound children wait durably while working; assignments awaiting launch return launch_pending so you can read again shortly. Start independent children before joining them.',
      inputSchema: childReadInput,
      execute: async (input, { toolCallId }) => {
        const resolved = await resolveChildRead(ports, input)
        if (resolved.feedback) return resolved.feedback
        const childRunId = resolved.childRunId!
        const parent = await ports.read()
        if (!parent.children.some(child => child.id === childRunId)) return { success: false, error: 'Unknown child handle for this run.',
          childRunIds: parent.children.map(child => child.id), hint: 'Use an actual childRunId, or use assignmentId from your assignment obligations. A missing child handle does not mean launch will not occur.' }
        let child = await ports.readChild(childRunId)
        if (child.parentRunId !== parent.runId || child.rootRunId !== parent.rootRunId) throw new Error('Invalid child lineage.')
        let assignment = await ports.readAssignmentResult?.(childRunId)
        if (!['completed', 'failed', 'cancelled'].includes(child.status) && !assignment?.blocker) {
          await ports.waitForChildren([childRunId])
          child = await ports.readChild(childRunId)
          if (child.parentRunId !== parent.runId || child.rootRunId !== parent.rootRunId) throw new Error('Invalid child lineage.')
          assignment = await ports.readAssignmentResult?.(childRunId)
        }
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
