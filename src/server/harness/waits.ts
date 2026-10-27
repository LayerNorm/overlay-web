import { createHook, FatalError, sleep } from 'workflow'
import type { HarnessWait, HarnessWaitRequest } from '@overlay/agent-runtime/harness-store'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { z } from 'zod'
import type { HarnessExecutionPorts } from './ports'
import { applyHarnessOperation, readHarnessState, type HarnessExecutionReference } from './state-steps'
import {
  listHarnessWaits, notifyHarnessAncestors,
  publishHarnessWait, readHarnessChild, resolveHarnessWait,
} from './personal-wait-steps'

const inputReply = z.object({ text: z.string().trim().min(1).max(32_000) })
const approvalReply = z.object({ approved: z.boolean(), reason: z.string().max(2_000).optional() })

export type HarnessWaitProjection = { wait: HarnessWait } | { status: 'running' | 'waiting_for_children' }

export function createHarnessWaitPorts(input: {
  reference: HarnessExecutionReference
  deliveryRunId?: string
  projectWait: (projection: HarnessWaitProjection) => Promise<'projected' | 'stale' | 'inactive'>
  // The workflow registers this hook before launching any children, and keeps
  // it alive until finalization. Notifications are buffered while the model runs.
  wake: AsyncIterator<unknown>
}): Pick<HarnessExecutionPorts, 'waitForInput' | 'waitForApproval' | 'waitForChildren'> {
  const access = input.reference
  const ownsDelivery = (state: HarnessSnapshot) => input.deliveryRunId
    ? state.runId === input.deliveryRunId
    : !state.parentRunId
  let sequence = 0

  const withDeadline = async <T>(pending: PromiseLike<T>, deadlineAt: number): Promise<T> => Promise.race([
    Promise.resolve(pending),
    sleep(new Date(deadlineAt)).then(() => { throw new FatalError('Harness deadline reached while waiting.') }),
  ])

  const receive = async (request: HarnessWaitRequest): Promise<unknown> => {
    using hook = createHook<unknown>({ token: request.token })
    if (await hook.getConflict()) throw new FatalError('Harness wait token is already owned.')
    const wait = await publishHarnessWait(access, request)
    const state = await readHarnessState(access)
    await notifyHarnessAncestors(access)
    if (ownsDelivery(state) && await input.projectWait({ wait }) === 'inactive') return null
    const result = await withDeadline(hook, state.policy.deadlineAt)
    await resolveHarnessWait(access, wait.token)
    await notifyHarnessAncestors(access)
    if (ownsDelivery(state)) await input.projectWait({ status: 'running' })
    return result
  }

  return {
    waitForInput: async () => {
      const token = `harness:wait:${access.workflowRunId}:${sequence++}`
      const reply = await receive({ kind: 'input', token })
      if (reply === null) return null
      const parsed = inputReply.safeParse(reply)
      if (!parsed.success) throw new FatalError('Invalid authenticated input response.')
      await applyHarnessOperation(access, `input-evidence:${token}`, { type: 'record_evidence', evidence: {
        id: `input:${token}`, kind: 'user_input', verdict: 'observed', source: `workflow-hook:${token}`,
        summary: parsed.data.text.slice(0, 2_000), createdAt: Date.now(),
      } })
      return [{ role: 'user', content: parsed.data.text }]
    },
    waitForApproval: async requests => {
      const token = `harness:wait:${access.workflowRunId}:${sequence++}`
      const reply = await receive({ kind: 'approval', token, requests })
      if (reply === null) return null
      const parsed = approvalReply.safeParse(reply)
      if (!parsed.success) throw new FatalError('Invalid authenticated approval response.')
      return requests.map(request => ({ approvalId: request.approvalId, ...parsed.data }))
    },
    waitForChildren: async childRunIds => {
      while (true) {
        const state = await readHarnessState(access)
        if (['completed', 'cancelled', 'failed'].includes(state.status)) return
        let settled = false
        for (const childRunId of childRunIds) {
          const child = await readHarnessChild(access, childRunId)
          if (['completed', 'cancelled', 'failed'].includes(child.status)) {
            if (child.modelReservation || child.children.some(descendant => ['running', 'cancelled'].includes(descendant.status))) {
              throw new FatalError('A child ended with unresolved model usage. Its billing holds were preserved; reconcile before continuing.')
            }
            await applyHarnessOperation(access, `settle-child:${child.runId}:${child.revision}`, { type: 'settle_child', childRunId })
            settled = true
          }
        }
        if (settled || !childRunIds.length) {
          if (ownsDelivery(state)) await input.projectWait({ status: 'running' })
          return
        }
        if (ownsDelivery(state)) {
          const [wait] = await listHarnessWaits(access)
          const projected = await input.projectWait(wait ? { wait } : { status: 'waiting_for_children' })
          if (projected === 'inactive') return
          if (projected === 'stale') continue
        }
        if ((await withDeadline(input.wake.next(), state.policy.deadlineAt)).done) {
          throw new FatalError('Child notification channel closed before completion.')
        }
      }
    },
  }
}
