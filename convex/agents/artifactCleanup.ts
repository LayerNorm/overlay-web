import { internalAction } from '../_generated/server'

/**
 * Convex owns artifact metadata but the BFF owns object-store credentials.
 * This scheduled bridge asks the BFF to delete expired objects before their
 * metadata is tombstoned.
 */
export const runCleanupTick = internalAction({
  args: {},
  handler: async () => {
    const baseUrl = process.env.OVERLAY_BFF_URL?.replace(/\/$/, '')
    if (!baseUrl) {
      console.warn('[ConnectedAgentArtifacts] OVERLAY_BFF_URL is not configured; cleanup deferred')
      return null
    }
    const internalSecret = process.env.INTERNAL_API_SECRET
    if (!internalSecret) throw new Error('connected_agent_artifact_cleanup_secret_missing')
    const response = await fetch(`${baseUrl}/api/v1/agent-environments/artifacts/cleanup`, {
      method: 'POST',
      headers: { 'x-internal-api-secret': internalSecret },
    })
    if (!response.ok) throw new Error(`connected_agent_artifact_cleanup_failed:${response.status}`)
    return null
  },
})
