import { isUsageExhaustedError } from '@overlay/chat-core'

export function isWorkspaceBillingError(message: string): boolean {
  const normalized = message.toLowerCase()
  return isUsageExhaustedError(message) || normalized.includes('payment required')
    || normalized.includes('subscribe to this workspace')
}
