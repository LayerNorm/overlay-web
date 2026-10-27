import { sleep } from 'workflow'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { OPENROUTER_FREE_MODEL_ID, OVERLAY_FREE_MODEL_ID } from '@/shared/ai/gateway/overlay-free-policy'

export function createHarnessCapacityWaiter() {
  let deadline: number | undefined
  return {
    reset: () => { deadline = undefined },
    wait: async (state: HarnessSnapshot, receiptId: string, modelId: string): Promise<boolean> => {
      const receipt = state.latestReceipt
      if (state.status !== 'running' || state.modelReservation || receipt?.id !== receiptId
        || receipt.modelId !== modelId || receipt.rejectionReason !== 'route_capacity'
        || (modelId !== OPENROUTER_FREE_MODEL_ID && modelId !== OVERLAY_FREE_MODEL_ID)) return false
      const now = Date.now()
      deadline = Math.min(deadline ?? now + 300_000, state.policy.deadlineAt)
      if (now >= deadline) return false
      await sleep(new Date(Math.min(now + 5_000, deadline)))
      return true
    },
  }
}
