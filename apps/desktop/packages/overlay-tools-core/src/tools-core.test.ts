import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'
import {
  allowedOverlayToolIdsForTurn,
  assertOverlayToolAllowed,
  jsonSchemaToZod,
  shouldPersistToolInvocation,
  toolCostBucketForId,
} from './index'

describe('@overlay/tools-core', () => {
  it('classifies browser tools into the browser bucket', () => {
    assert.equal(toolCostBucketForId('browser_run_task'), 'browser')
    assert.equal(toolCostBucketForId('interactive_browser_session'), 'browser')
    assert.equal(shouldPersistToolInvocation('browser'), true)
  })

  it('keeps high-risk browser session gated from extension clients', () => {
    const ids = allowedOverlayToolIdsForTurn({
      latestUserText: 'open the website and take a screenshot',
      clientSurface: 'chrome-extension',
    })

    assert.equal(ids.includes('interactive_browser_session'), false)
  })

  it('authorizes only globally registered and exposed tools', () => {
    assert.doesNotThrow(() => assertOverlayToolAllowed('search_knowledge', ['search_knowledge']))
    assert.throws(() => assertOverlayToolAllowed('search_knowledge', ['list_notes']), /not exposed/)
    assert.throws(() => assertOverlayToolAllowed('unknown_tool'), /not allowed/)
  })

  it('converts JSON schema objects into zod validators', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 2 },
        count: { type: 'integer', minimum: 1 },
      },
    })

    assert.deepEqual(schema.parse({ name: 'ok' }), { name: 'ok' })
    assert.deepEqual(schema.parse({ name: 'ok', count: 2 }), { name: 'ok', count: 2 })
    assert.throws(() => schema.parse({ name: 'x' }), z.ZodError)
  })
})
