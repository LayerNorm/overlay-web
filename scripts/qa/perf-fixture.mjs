import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { fixtureBackendUrl } from './perf-baseline-lib.mjs'

export function fixtureStarter({ origin, backend, deployKey, allowed, conversationId }) {
  const url = fixtureBackendUrl(origin, backend)
  if (allowed !== '1' || !deployKey || !/^[0-9a-z]{20,40}$/.test(conversationId ?? '')) {
    throw new Error('Explicit fixture mutation approval, scoped credentials and fixture conversation required')
  }
  // This credential stays in the Node process, never in the measured browser.
  const client = new ConvexHttpClient(url, { logger: false })
  client.setAdminAuth(deployKey)
  return async () => {
    await client.mutation(makeFunctionReference('dev/performanceQa:startStreaming'), { conversationId })
  }
}
