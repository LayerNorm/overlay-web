import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'
import {
  COMPUTER_TOOL_IDS,
  allowedOverlayToolIdsForTurn,
  assertOverlayToolAllowed,
  jsonSchemaToZod,
  overlayToolIdSet,
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

  it('registers the agent-management and computer tools that build.ts asserts', () => {
    // Every assertToolAllowed id in build.ts must exist here or the execute
    // throws "not allowed" regardless of the turn allow-list.
    const registry = overlayToolIdSet()
    for (const id of ['create_agent', 'update_agent', ...COMPUTER_TOOL_IDS]) {
      assert.ok(registry.has(id), `${id} missing from OVERLAY_TOOL_IDS`)
    }
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
