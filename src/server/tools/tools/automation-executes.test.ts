import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { executeDeleteAutomation, executePauseAutomation, executeUpdateAutomation } from './overlay-executes'
import type { OverlayToolsOptions } from './types'

const chat: OverlayToolsOptions = { userId: 'user_1', workspaceId: 'ws_1', baseUrl: 'https://overlay.test' }
/** A turn that is itself an automation run carries that run's automation id. */
const insideAutomation: OverlayToolsOptions = { ...chat, automationId: 'running-automation' }

function captureBodies() {
  const originalFetch = globalThis.fetch
  const sent: Array<{ method: string; body: Record<string, unknown> }> = []
  globalThis.fetch = (async (_input, init) => {
    sent.push({ method: String(init?.method), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return Response.json({ success: true })
  }) as typeof fetch
  return { sent, restore: () => { globalThis.fetch = originalFetch } }
}

for (const [label, options] of [['in chat', chat], ['inside another automation', insideAutomation]] as const) {
  test(`update, pause, and delete act on the automation they name ${label}`, async () => {
    const api = captureBodies()
    try {
      assert.equal((await executeUpdateAutomation(options, { automationId: 'target', description: 'new' })).success, true)
      assert.equal((await executePauseAutomation(options, { automationId: 'target' })).success, true)
      assert.equal((await executeDeleteAutomation(options, { automationId: 'target' })).success, true)
      assert.deepEqual(api.sent.map((request) => [request.method, request.body.automationId]), [
        ['PATCH', 'target'], ['PATCH', 'target'], ['DELETE', 'target'],
      ])
      assert.equal(api.sent[1]!.body.action, 'pause')
      assert.equal(api.sent[0]!.body.description, 'new')
    } finally {
      api.restore()
    }
  })
}
