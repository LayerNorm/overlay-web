import { v } from 'convex/values'
import { internalAction } from '../_generated/server'

/**
 * Fires when an agent machine's idle window ends. The machine is stopped by the BFF (provider credentials stay
 * there); the BFF ignores the call when the token is no longer the lease's current one, which is how a new message
 * cancels a timer. If this call is lost, the meter's sweep stops the machine a little later.
 */
export const runIdleCheck = internalAction({
  args: { workspaceId: v.string(), leaseId: v.string(), token: v.string() },
  handler: async (_ctx, args) => {
    const baseUrl = process.env.OVERLAY_BFF_URL?.replace(/\/$/, '')
    if (!baseUrl) {
      console.warn('[AgentIdleStop] OVERLAY_BFF_URL is not configured; the meter sweep will stop idle machines')
      return null
    }
    const internalSecret = process.env.INTERNAL_API_SECRET
    if (!internalSecret) throw new Error('agent_idle_check_secret_missing')
    const response = await fetch(`${baseUrl}/api/v1/agent-environments/operations/reconcile`, {
      method: 'POST',
      headers: { 'x-internal-api-secret': internalSecret, 'content-type': 'application/json' },
      body: JSON.stringify({ idleCheck: args }),
    })
    if (!response.ok) throw new Error(`agent_idle_check_failed:${response.status}`)
    return null
  },
})
