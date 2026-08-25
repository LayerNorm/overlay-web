import { internalAction } from '../_generated/server'

/** Provider credentials stay in the BFF; Convex schedules its durable settlement retry. */
export const runReconciliationTick = internalAction({
  args: {},
  handler: async () => {
    const baseUrl = process.env.OVERLAY_BFF_URL?.replace(/\/$/, '')
    if (!baseUrl) {
      console.warn('[ConnectedAgentBilling] OVERLAY_BFF_URL is not configured; reconciliation deferred')
      return null
    }
    const internalSecret = process.env.INTERNAL_API_SECRET
    if (!internalSecret) throw new Error('connected_agent_settlement_reconciliation_secret_missing')
    const response = await fetch(`${baseUrl}/api/v1/agent-environments/operations/reconcile`, {
      method: 'POST',
      headers: { 'x-internal-api-secret': internalSecret },
    })
    if (!response.ok) throw new Error(`connected_agent_settlement_reconciliation_failed:${response.status}`)
    return null
  },
})
