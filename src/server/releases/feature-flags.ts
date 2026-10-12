import 'server-only'

import { getPostHogClient } from '@/server/observability/posthog-server'

type FlagClient = {
  evaluateFlags: (userId: string, options: {
    flagKeys: string[]
    personProperties: { workspace_id: string }
    disableGeoip: boolean
  }) => Promise<{ getFlag: (key: string) => unknown }>
}

/** Create once per request, after authenticating and resolving the workspace. */
export function createReleaseFlags(
  subject: { userId: string; workspaceId: string },
  keys: readonly string[],
  dependencies: { client?: () => FlagClient | null; timeoutMs?: number } = {},
) {
  const requested = [...new Set(keys)]
  if (requested.length > 64 || requested.some(key => !/^[a-z][a-z0-9-]{0,99}$/.test(key))) {
    throw new Error('Release flags require at most 64 explicit flag keys')
  }
  let evaluation: Promise<Map<string, boolean>> | undefined

  async function evaluate(): Promise<Map<string, boolean>> {
    const defaults = new Map(requested.map(key => [key, false]))
    if (!subject.userId.trim() || !subject.workspaceId.trim() || !requested.length) return defaults
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const client = (dependencies.client ?? getPostHogClient)()
      if (!client) return defaults
      const timeoutMs = Math.min(1000, Math.max(1, dependencies.timeoutMs ?? 300))
      const flags = await Promise.race([
        client.evaluateFlags(subject.userId, {
          flagKeys: requested, personProperties: { workspace_id: subject.workspaceId }, disableGeoip: true,
        }),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs) }),
      ])
      if (!flags) return defaults
      // This helper deliberately supports boolean release gates. A missing flag,
      // multivariate value, disabled provider, quota failure or outage stays dark.
      return new Map(requested.map(key => [key, flags.getFlag(key) === true]))
    } catch (_error) {
      return defaults
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  return {
    async isEnabled(key: string): Promise<boolean> {
      if (!requested.includes(key)) return false
      evaluation ??= evaluate()
      return (await evaluation).get(key) === true
    },
  }
}
