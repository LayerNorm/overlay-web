import 'server-only'

import test from 'node:test'
import { ConvexAutomationRepository } from '@/server/automations/ConvexAutomationRepository'
import { ConvexWebhookRepository } from '@/server/webhooks'
import { runAutomationWebhookContract } from './automation-webhook-contract'

const enabled = process.env.APP_DATA_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('real Convex automation and webhook provider contract', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set APP_DATA_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async (t) => {
  await runAutomationWebhookContract(t, {
    automations: new ConvexAutomationRepository(),
    provider: 'convex',
    webhooks: new ConvexWebhookRepository(),
  })
})
