import type { ToolSet } from 'ai'
import { assertHarnessRunnable, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { createHarnessControlTools } from './control-tools'
import type { HarnessExecutionPorts } from './ports'
import { createHarnessToolApprovals, type HarnessToolApprovals, type HarnessToolExecutionOptions } from './tool-approvals'
import { harnessToolInputDigest } from './tool-input-digest'

const DUPLICATE_GUARDED_CREATE_TOOLS = new Set([
  'create_note', 'create_task', 'create_automation', 'create_folder', 'create_agent',
])

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
): { tools: ToolSet; approvals: HarnessToolApprovals } {
  const approvals = createHarnessToolApprovals()
  const definitions = { ...surfaceTools, ...createHarnessControlTools(ports) }
  let toolTail: Promise<unknown> = Promise.resolve()
  const tools = Object.fromEntries(Object.entries(definitions).sort(([a], [b]) => a.localeCompare(b)).map(([name, definition]) => {
    const execute = definition.execute
    return [name, !execute ? definition : {
      ...definition,
      execute: (value: unknown, options: Parameters<NonNullable<typeof execute>>[1]) => {
        const pending = toolTail.then(async () => {
          const state = await ports.read()
          assertHarnessRunnable(state, Date.now())
          if (!controls.has(name)) {
            if (!state.policy.allowedToolIds.includes(name)) throw new Error('This tool is not authorized for this run.')
            if (state.policy.requiresPlan && !state.plan.length) throw new Error('Create the required plan before executing work.')
            await ports.authorizeTool(name)
          }
          const duplicate = duplicateCreateEvidence(state, name, value)
          if (duplicate) {
            return {
              success: false,
              error: `Duplicate: this exact ${name} call already succeeded as evidence ${duplicate.id}. Cite that evidence instead of repeating it.`,
            }
          }
          const invoke = execute as (
            input: unknown,
            options: HarnessToolExecutionOptions,
          ) => unknown
          return invoke(value, { ...options, harnessApproved: approvals.consume(name, options.toolCallId, value) })
        })
        toolTail = pending.then(() => undefined, () => undefined)
        return pending
      },
    }]
  }))
  return { tools, approvals }
}
