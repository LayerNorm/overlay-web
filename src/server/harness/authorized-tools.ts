import type { ToolSet } from 'ai'
import { assertHarnessRunnable, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { createHarnessControlTools } from './control-tools'
import type { HarnessExecutionPorts } from './ports'
import { createHarnessToolApprovals, type HarnessToolApprovals, type HarnessToolExecutionOptions } from './tool-approvals'
import { harnessToolInputDigest } from './tool-input-digest'
import { redactSecrets } from '@/shared/security/sentry-sanitize'
import { createHarnessToolScheduler, harnessToolRunMode } from './tool-run-modes'
import { toolRequiresApproval } from '@overlay/tools-core/policy'

const DUPLICATE_GUARDED_CREATE_TOOLS = new Set([
  'create_note', 'create_task', 'create_automation', 'create_folder', 'create_agent',
])

const MAX_TOOL_FAILURE_DETAIL = 300

/**
 * A tool that throws never ends the run. The agent gets the failure as that
 * call's result, so it can retry, take another route or tell the person what
 * went wrong. Only the agent can judge whether repeating the call is safe.
 */
export function harnessToolFailure(name: string, error: unknown): Error {
  // Errors that crossed a durable step boundary are plain objects, not Error instances.
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : error
  const raw = typeof message === 'string' ? message : ''
  const detail = redactSecrets(raw.replace(/\s+/g, ' ').trim()).slice(0, MAX_TOOL_FAILURE_DETAIL)
  return Object.assign(new Error(
    `${name} failed${detail ? `: ${detail}` : '.'}${detail && !/[.!?]$/.test(detail) ? '.' : ''} `
    + 'If this call only reads or looks something up, nothing changed: retry it or try another approach. '
    + 'If it changes something, check whether it took effect before repeating it. '
    + 'If you cannot work around it, tell the person plainly what failed and what you did instead.',
  ), { toolName: name })
}

function duplicateCreateEvidence(state: HarnessSnapshot, name: string, input: unknown): HarnessSnapshot['evidence'][number] | undefined {
  if (!DUPLICATE_GUARDED_CREATE_TOOLS.has(name)) return undefined
  const inputDigest = harnessToolInputDigest(name, input)
  return state.evidence.find(evidence => evidence.kind === 'tool_result'
    && evidence.verdict !== 'failed' && evidence.source === name && evidence.inputDigest === inputDigest)
}

export function createHarnessAuthorizedTools(
  surfaceTools: ToolSet,
  ports: HarnessExecutionPorts,
  controls: Set<string>,
  initialApprovals?: Parameters<typeof createHarnessToolApprovals>[0],
  guard?: { publicProgress(): boolean },
): { tools: ToolSet; approvals: HarnessToolApprovals } {
  const approvals = createHarnessToolApprovals(initialApprovals)
  const definitions = { ...surfaceTools, ...createHarnessControlTools(ports) }
  // Calls from one model step arrive together. Read-only calls overlap, calls on one resource keep their order,
  // and control or approval-gated calls run alone.
  const scheduler = createHarnessToolScheduler()
  // Lease renewal and tool authorization compare-and-swap the run's revision, so two overlapping calls would
  // conflict. Admission runs one call at a time; only the tools themselves overlap.
  let admission: Promise<unknown> = Promise.resolve()
  const admit = (name: string): Promise<HarnessSnapshot> => {
    const next = admission.then(async () => {
      if (guard?.publicProgress()) throw new Error("Tools are disabled during a public progress update.")
      let state = await ports.read()
      if (state.policy.executionPolicyVersion === 2) {
        await ports.renewLease()
        state = await ports.read()
      }
      assertHarnessRunnable(state, Date.now())
      if (!controls.has(name)) {
        if (!state.policy.allowedToolIds.includes(name)) throw new Error('This tool is not authorized for this run.')
        await ports.authorizeTool(name)
      }
      return state
    })
    // The failing call reports its own error; the next call still gets its turn.
    admission = next.catch((_error: unknown) => undefined)
    return next
  }
  const tools = Object.fromEntries(Object.entries(definitions).sort(([a], [b]) => a.localeCompare(b)).map(([name, definition]) => {
    const execute = definition.execute
    return [name, !execute ? definition : {
      ...definition,
      execute: (value: unknown, options: Parameters<NonNullable<typeof execute>>[1]) => {
        // Approval itself happens before execute; this only keeps gated actions from overlapping other work.
        const gated = definition.needsApproval === true
          || (typeof definition.needsApproval === 'function' && toolRequiresApproval(name, value))
        const mode = harnessToolRunMode(name, value, { control: controls.has(name), needsApproval: gated })
        return scheduler.run(mode, async () => {
          const state = await admit(name)
          const duplicate = duplicateCreateEvidence(state, name, value)
          if (duplicate) {
            return {
              success: false,
              error: `Duplicate: this exact ${name} call already succeeded as evidence ${duplicate.id}. Use that result instead of repeating it.`,
            }
          }
          const invoke = execute as (
            input: unknown,
            options: HarnessToolExecutionOptions,
          ) => unknown
          try {
            return await invoke(value, { ...options, harnessApproved: approvals.consume(name, options.toolCallId, value) })
          } catch (error) {
            if (controls.has(name)) throw error
            throw harnessToolFailure(name, error)
          }
        })
      },
    }]
  }))
  return { tools, approvals }
}
