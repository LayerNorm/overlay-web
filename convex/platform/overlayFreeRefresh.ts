import { internalAction } from '../_generated/server'

export const runTick = internalAction({
  args: {},
  handler: async () => {
    const baseUrl = process.env.OVERLAY_BFF_URL?.trim().replace(/\/$/, '')
    if (!baseUrl) {
      console.warn('[overlay-free] OVERLAY_BFF_URL is not configured; refresh deferred')
      return null
    }
    const secret = process.env.INTERNAL_API_SECRET?.trim()
    if (!secret) throw new Error('overlay_free_refresh_secret_missing')
    const response = await fetch(`${baseUrl}/api/v1/models/overlay-free/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-api-secret': secret,
      },
      body: '{}',
    })
    if (!response.ok) throw new Error(`overlay_free_refresh_failed:${response.status}`)
    return null
  },
})
