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
        requiresVerification: z.boolean(),
      })).min(1).max(128) }),
      execute: async ({ steps }, { toolCallId }) => {
        const state = await ports.apply(`control:${toolCallId}`, { type: 'replace_plan', steps })
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
        const state = await ports.apply(`control:${toolCallId}`, { type: 'transition_step', ...input })
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
      description: 'Read the bounded result of an admitted child. Do not poll running children; the controller waits durably.',
      inputSchema: z.object({ childRunId: id }),
      execute: async ({ childRunId }) => {
        const parent = await ports.read()
        if (!parent.children.some(child => child.id === childRunId)) throw new Error('This run did not delegate that child.')
        const child = await ports.readChild(childRunId)
        if (child.parentRunId !== parent.runId || child.rootRunId !== parent.rootRunId) throw new Error('Invalid child lineage.')
        return { status: child.status, summary: child.resultSummary ?? child.workingSummary, evidence: child.evidence, blocker: child.blocker }
      },
    }),
  }
}
