import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod/v3'
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
    assert.equal(toolCostBucketForId('computer_browser'), 'internal')
    assert.equal(shouldPersistToolInvocation('browser'), true)
  })

  it('keeps high-risk browser session gated from extension clients', () => {
    const ids = allowedOverlayToolIdsForTurn({
      latestUserText: 'open the website and take a screenshot',
      clientSurface: 'chrome-extension',
    })

    assert.equal(ids.includes('computer_browser'), false)
  })

  it('exposes the task tools for explicit Work requests', () => {
    const ids = allowedOverlayToolIdsForTurn({ latestUserText: 'Create a task and assign it to the research agent' })
    for (const id of ['list_tasks', 'get_task', 'create_task', 'update_task', 'comment_on_task', 'archive_task', 'restore_task']) {
      assert.ok(ids.includes(id), `${id} missing from explicit task request`)
    }
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
    assert.equal(registry.has('interactive_browser_session'), false)
    assert.equal(registry.has('browser_run_task'), false)
    for (const id of COMPUTER_TOOL_IDS) assert.equal(toolCostBucketForId(id), 'internal')
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
