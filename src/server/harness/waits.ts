import { createHook, FatalError, sleep } from 'workflow'
import type { HarnessWait, HarnessWaitRequest } from '@overlay/agent-runtime/harness-store'
import { effectiveHarnessDeadlineAt, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { z } from 'zod'
import type { HarnessExecutionPorts } from './ports'
import { applyHarnessOperation, readHarnessState, type HarnessExecutionReference } from './state-steps'
import { waitForHarnessHumanReply } from './resource-boundary'
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
  renewLease: () => Promise<void>
  checkFunding: (requiredCents: number) => Promise<boolean>
  projectWait: (projection: HarnessWaitProjection) => Promise<'projected' | 'stale' | 'inactive'>
  readState?: (reference: HarnessExecutionReference) => Promise<HarnessSnapshot>
  // The workflow registers this hook before launching any children, and keeps
  // it alive until finalization. Notifications are buffered while the model runs.
  wake: AsyncIterator<unknown>
}): Pick<HarnessExecutionPorts, 'waitForInput' | 'waitForApproval' | 'waitForChildren' | 'waitForFunding' | 'checkFunding'> {
  const access = input.reference
  const readState = () => input.readState ? input.readState(access) : readHarnessState(access)
  const ownsDelivery = (state: HarnessSnapshot) => input.deliveryRunId
    ? state.runId === input.deliveryRunId
    : !state.parentRunId
  let sequence = 0
  let pendingWake: Promise<IteratorResult<unknown>> | undefined
  const nextWake = () => {
    pendingWake ??= input.wake.next().finally(() => { pendingWake = undefined })
    return pendingWake
  }

  const withDeadline = async <T>(pending: PromiseLike<T>, deadlineAt: number): Promise<T> => Promise.race([
    Promise.resolve(pending),
    sleep(new Date(deadlineAt)).then(() => { throw new FatalError('Harness deadline reached while waiting.') }),
  ])
  const withRenewableLease = async <T>(pending: PromiseLike<T>, state: HarnessSnapshot): Promise<T> => {
    const result = Promise.resolve(pending)
    while (true) {
      const now = Date.now()
      if (state.policy.taskDeadlineAt !== undefined && now >= state.policy.taskDeadlineAt) {
        throw new FatalError('The explicit harness task deadline was reached while waiting.')
      }
      const pollAt = Math.min(now + 60_000, state.policy.taskDeadlineAt ?? Number.MAX_SAFE_INTEGER)
      const wake = await Promise.race([
        result.then(value => ({ kind: 'reply' as const, value })),
        sleep(new Date(pollAt)).then(() => ({ kind: 'poll' as const })),
      ])
      if (wake.kind === 'reply') return wake.value
      if (state.policy.taskDeadlineAt !== undefined && Date.now() >= state.policy.taskDeadlineAt) {
        throw new FatalError('The explicit harness task deadline was reached while waiting.')
      }
      await input.renewLease()
    }
  }

  const receive = async (request: HarnessWaitRequest): Promise<unknown> => {
    using hook = createHook<unknown>({ token: request.token })
    if (await hook.getConflict()) throw new FatalError('Harness wait token is already owned.')
    const wait = await publishHarnessWait(access, request)
    const state = await readHarnessState(access)
    await notifyHarnessAncestors(access)
    if (ownsDelivery(state) && await input.projectWait({ wait }) === 'inactive') return null
    const result = state.policy.resourcePauseVersion === 1
      ? await waitForHarnessHumanReply(access, hook, request.kind, () => readHarnessState(access))
      : state.policy.executionPolicyVersion === 2
        ? await withRenewableLease(hook, state)
        : await withDeadline(hook, effectiveHarnessDeadlineAt(state.policy))
    if (result === null) return null
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
        if (state.policy.executionPolicyVersion === 2) {
          const wake = await Promise.race([
            nextWake().then(event => ({ kind: 'notification' as const, event })),
            sleep(new Date(Date.now() + 60_000)).then(() => ({ kind: 'poll' as const })),
          ])
          if (wake.kind === 'notification') {
            if (wake.event.done) throw new FatalError('Child notification channel closed before completion.')
          } else {
            await input.renewLease()
          }
        } else {
          const wake = await withDeadline(nextWake(), effectiveHarnessDeadlineAt(state.policy))
          if (wake.done) throw new FatalError('Child notification channel closed before completion.')
        }
      }
    },
    waitForFunding: async () => {
      const state = await readState()
      if (['completed', 'failed', 'cancelled'].includes(state.status)) return
      await Promise.race([nextWake(), sleep(new Date(Date.now() + 60_000))])
      const current = await readState()
      if (['completed', 'failed', 'cancelled'].includes(current.status)
        || current.status !== 'waiting_for_resources') return
      await input.renewLease()
    },
    checkFunding: input.checkFunding,
  }
}
