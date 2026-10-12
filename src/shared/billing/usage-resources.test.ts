import test from 'node:test'
import assert from 'node:assert/strict'

import { formatUsageQuantity, humanizeModelId, totalUsage, usageResourceFor } from './usage-resources'

test('charges map to the resource a person pays for', () => {
  assert.equal(usageResourceFor({ kind: 'sandbox', operationId: 'workspace-agent-sandbox:t1' }), 'computers')
  assert.equal(usageResourceFor({ kind: 'generation', operationId: 'websearch.web_search:abc' }), 'web_search')
  assert.equal(usageResourceFor({ kind: 'generation', operationId: 'agent.browser-task' }), 'browser_tasks')
  assert.equal(usageResourceFor({ kind: 'generation', operationId: 'media.generate-image' }), 'images')
  assert.equal(usageResourceFor({ kind: 'generation', operationId: 'media.generate-video' }), 'video')
  assert.equal(usageResourceFor({ kind: 'transcription', operationId: 'audio.transcribe' }), 'transcription')
  assert.equal(usageResourceFor({ kind: 'generation', operationId: 'knowledge.compile-memory-profile' }), 'memory')
  assert.equal(usageResourceFor({ kind: 'embedding', operationId: 'knowledge.index-message-content' }), 'knowledge')
  assert.equal(usageResourceFor({ kind: 'agent', operationId: 'conversation.act', modelId: 'gpt-5.4' }), 'models')
})

test('totals add up per resource, largest first, with models split per model', () => {
  const totals = totalUsage([
    { kind: 'agent', operationId: 'conversation.act', modelId: 'gpt-5.4', cents: 30, tokens: 1_000 },
    { kind: 'agent', operationId: 'conversation.act', modelId: 'gpt-5.4', cents: 20, tokens: 500 },
    { kind: 'ask', operationId: 'conversation.act', modelId: 'claude', cents: 5, tokens: 100 },
    { kind: 'sandbox', operationId: 'lease', cents: 40, seconds: 3_900 },
    { kind: 'generation', operationId: 'websearch.web_search:1', cents: 2 },
  ])
  assert.deepEqual(totals.map((t) => [t.resource, t.cents, t.count]), [['models', 55, 3], ['computers', 40, 1], ['web_search', 2, 1]])
  assert.deepEqual(totals[0].byModel?.map((m) => [m.modelId, m.cents, m.count]), [['gpt-5.4', 50, 2], ['claude', 5, 1]])
  assert.equal(formatUsageQuantity(totals[0]), '1.6K tokens')
  assert.equal(formatUsageQuantity(totals[1]), '1h 05m')
  assert.equal(formatUsageQuantity(totals[2]), '1 search')
})

test('automation steps are their own resource, and unknown model ids read as names', () => {
  assert.equal(usageResourceFor({ kind: 'agent', operationId: 'automation.workflow-run', modelId: 'workflow-steps' }), 'automations')
  assert.equal(usageResourceFor({ kind: 'agent', operationId: 'automation.workflow-run', modelId: 'anthropic/claude-sonnet-4.6' }), 'models')
  assert.equal(humanizeModelId('gpt-5.6-luna'), 'GPT 5.6 Luna')
  assert.equal(humanizeModelId('meta/muse-spark-1.3-contributor'), 'Muse Spark 1.3 Contributor')
})
