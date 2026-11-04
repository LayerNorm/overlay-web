import { tool } from 'ai'
import { z } from 'zod'
import { HarnessPlanValidationError, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessArtifactReadResult, HarnessExecutionPorts } from './ports'
import { HARNESS_STEP_VALIDATION } from './step-validation'
import { FILE_ANALYSIS_LIMITS, fileAnalysisBrief, type FileAnalysisPartition } from './file-analysis-policy'
import { fileAnalysisConstraints } from './file-analysis-coverage'

const id = z.string().min(1).max(256)
const evidenceReferenceError = HARNESS_STEP_VALIDATION.evidenceReference
const completionErrors = new Set<string>([
  HARNESS_STEP_VALIDATION.evidenceRequired,
  HARNESS_STEP_VALIDATION.toolEvidenceRequired,
  HARNESS_STEP_VALIDATION.matchingToolEvidenceRequired,
])
const dependencyError = HARNESS_STEP_VALIDATION.dependencies
const reusedToolResultEvidenceError = HARNESS_STEP_VALIDATION.reusedToolEvidence
const reportingHint = 'If this milestone only reports prior results, use harness_set_plan to set answerOnly: true, omit evidenceTools, and set requiresVerification: false for this milestone. Preserve every other milestone exactly, including completed action IDs, titles, dependencies and acceptance criteria. Then return the requested answer using the saved result; do not repeat the completed action.'
const completionHint = `Cite tool:<id> evidence that supports this milestone. For a milestone that reopens an artifact, declare evidenceTools: ["harness_read_artifact"] with harness_set_plan; a reopened excerpt cannot prove a new source-tool write. ${reportingHint}`

function artifactIdentity(metadata: HarnessArtifactReadResult['metadata']): string {
  const resource = metadata.resource
    ? `; resource ${metadata.resource.id}${metadata.resource.revision ? ` revision ${metadata.resource.revision}` : ''}${metadata.resource.operation ? ` operation ${metadata.resource.operation}` : ''}${metadata.resource.page ? ` page ${metadata.resource.page}` : ''}`
    : ''
  return `artifact ${metadata.artifactId}; ${metadata.toolName} call ${metadata.toolCallId}${resource}`
}

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
      hint: `For a separate action, cite its own successful tool result; one result cannot prove two actions. ${reportingHint}`,
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
    ...(ports.fileAnalysisEnabled ? {
      harness_analyze_files: tool({
        description: 'Start a bounded recursive file-analysis child for assigned versioned page ranges. Uses existing shared budget, depth and concurrency limits. Keep large inputs outside parent context; join with harness_read_child and report examined versus missing coverage.',
        inputSchema: z.object({
          stepId: id,
          goal: z.string().min(1).max(FILE_ANALYSIS_LIMITS.maxGoalChars),
          partitions: z.array(z.object({
            fileId: id, revision: z.string().min(1).max(256),
            startPage: z.number().int().positive(), endPage: z.number().int().positive(),
          })).min(1).max(FILE_ANALYSIS_LIMITS.maxPartitions),
          maxCostMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        }).superRefine((input, context) => {
          const assigned = new Map<string, Array<[number, number]>>()
          input.partitions.forEach((partition, index) => {
            if (partition.endPage < partition.startPage
              || partition.endPage - partition.startPage + 1 > 20) {
              context.addIssue({ code: 'custom', path: ['partitions', index], message: 'Page ranges must contain 1 to 20 pages.' })
            }
            const key = `${partition.fileId}:${partition.revision}`
            const ranges = assigned.get(key) ?? []
            if (ranges.some(([start, end]) => partition.startPage <= end && partition.endPage >= start)) {
              context.addIssue({ code: 'custom', path: ['partitions', index], message: 'Assignments for the same revision cannot overlap.' })
            }
            ranges.push([partition.startPage, partition.endPage])
            assigned.set(key, ranges)
          })
        }),
        execute: async (input, { toolCallId }) => {
          const state = await ports.read()
          if (state.status === 'cancelled' || ['completed', 'failed'].includes(state.status)) {
            return { success: false, error: 'This run can no longer launch children.' }
          }
          const allow = new Set([
            'read_file', 'read_document', 'search_in_files', 'computer_exec',
            'computer_read_file', 'computer_write_file', 'list_files',
          ])
          const granted = new Set(state.policy.allowedToolIds)
          if (!granted.has('read_file') || !granted.has('read_document') || !granted.has('computer_exec')) {
            return { success: false, error: 'File reading tools are not granted to this run.' }
          }
          const allowedToolIds = [...allow].filter(name => granted.has(name))
          const partitions = input.partitions as FileAnalysisPartition[]
          return await ports.delegate({
            stepId: input.stepId,
            goal: fileAnalysisBrief(input.goal, partitions),
            constraints: fileAnalysisConstraints(partitions, toolCallId),
            allowedToolIds,
            maxCostMicros: input.maxCostMicros,
          }, toolCallId)
        },
      }),
    } : {}),
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
          const verificationError = HARNESS_STEP_VALIDATION.verification
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
      description: 'Read a persisted observation by evidence ID, or list a bounded chronological page of observation IDs and outcomes. Omitted or truncated content is not proof of absence.',
      inputSchema: z.object({
        evidenceId: z.string().min(1).max(512).optional(),
        cursor: z.string().max(512).optional(),
        limit: z.number().int().min(1).max(32).optional(),
      }),
      execute: async ({ evidenceId, cursor, limit }) => ports.readEvidence(evidenceId ?? '', cursor, limit),
    }),
    harness_read_artifact: tool({
      description: 'Reopen a private tool-result artifact using a bounded text range or a selected media-part index. Access is reauthorized against the original source tool. Read milestones should declare evidenceTools: ["harness_read_artifact"]; this observation cannot prove a new source-tool write.',
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
      description: 'Start a bounded child for an independent ready milestone. Legacy runs require a spend allocation; v2 runs use their configured payer without a child lifetime cap. Grant only the tools it needs. Children receive a brief, not the parent transcript.',
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
        const coverage = ports.readFileCoverage ? await ports.readFileCoverage(childRunId) : null
        const result = { status: child.status, summary: child.resultSummary ?? child.workingSummary, evidence: child.evidence, blocker: child.blocker,
          ...(coverage ? { coverage } : {}) }
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
