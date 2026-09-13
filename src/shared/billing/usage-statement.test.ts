import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildUsageStatement,
  normalizeUsageStatementLinesLimit,
  normalizeUsageStatementOffset,
  usageStatementCategoryForKind,
  type UsageStatementCategory,
  type UsageStatementLine,
} from './usage-statement'
import {
  COMPOSIO_TOOL_CALL_PRICE_USD,
  toolCallBillableCostUsd,
} from './tool-pricing'

function line(costCents: number, occurredAt: number, label = 'model'): UsageStatementLine {
  return { costCents, id: `${label}-${occurredAt}`, label, occurredAt }
}

test('statement categories map usage kinds onto bill buckets', () => {
  assert.equal(usageStatementCategoryForKind('ask'), 'models')
  assert.equal(usageStatementCategoryForKind('agent'), 'models')
  assert.equal(usageStatementCategoryForKind('write'), 'models')
  assert.equal(usageStatementCategoryForKind('embedding'), 'models')
  assert.equal(usageStatementCategoryForKind('transcription'), 'transcription')
  assert.equal(usageStatementCategoryForKind('sandbox'), 'sandbox')
  assert.equal(usageStatementCategoryForKind('generation', 'browser-use/bu-1'), 'browser')
  assert.equal(usageStatementCategoryForKind('generation', 'openai/gpt-image-1'), 'generation')
  assert.equal(usageStatementCategoryForKind('generation'), 'generation')
})

test('buildUsageStatement groups, totals, and caps per-category lines', () => {
  const models = Array.from({ length: 12 }, (_, index) => line(10, 1_000 + index, 'gpt-5'))
  const tools = [line(0.03, 500, 'composio/gmail.send'), line(0.03, 600, 'composio/slack.post')]
  const statement = buildUsageStatement({
    billingAccountId: 'ba_test',
    linesByCategory: new Map<UsageStatementCategory, UsageStatementLine[]>([
      ['models', models],
      ['tools', tools],
    ]),
    linesPerCategory: 10,
    periodEnd: 100_000,
    periodStart: 0,
  })
  assert.equal(statement.totalCents, 120.06)
  assert.equal(statement.categories.length, 2)
  const modelsSummary = statement.categories.find((c) => c.category === 'models')!
  assert.equal(modelsSummary.count, 12)
  assert.equal(modelsSummary.lines.length, 10)
  assert.equal(modelsSummary.hasMore, true)
  assert.equal(modelsSummary.lines[0]!.occurredAt, 1_011)
  const toolsSummary = statement.categories.find((c) => c.category === 'tools')!
  assert.equal(toolsSummary.count, 2)
  assert.equal(toolsSummary.hasMore, false)
  assert.equal(toolsSummary.totalCents, 0.06)
})

test('buildUsageStatement skips empty categories and preserves a zero bill', () => {
  const statement = buildUsageStatement({
    billingAccountId: 'ba_empty',
    linesByCategory: new Map(),
    periodStart: 42,
  })
  assert.equal(statement.totalCents, 0)
  assert.deepEqual(statement.categories, [])
  assert.equal(statement.periodStart, 42)
  assert.equal(statement.periodEnd, undefined)
})

test('statement line limits clamp to the 10-per-page default and 50 max', () => {
  assert.equal(normalizeUsageStatementLinesLimit(undefined), 10)
  assert.equal(normalizeUsageStatementLinesLimit(7), 7)
  assert.equal(normalizeUsageStatementLinesLimit(500), 50)
  assert.equal(normalizeUsageStatementLinesLimit(0), 1)
  assert.equal(normalizeUsageStatementOffset(undefined), 0)
  assert.equal(normalizeUsageStatementOffset(-3), 0)
  assert.equal(normalizeUsageStatementOffset(9.9), 9)
})

test('composio tool calls are billed at $0.0003 and other buckets stay unrated', () => {
  assert.equal(toolCallBillableCostUsd('composio'), 0.0003)
  assert.equal(COMPOSIO_TOOL_CALL_PRICE_USD, 0.0003)
  for (const bucket of ['perplexity', 'image', 'video', 'browser', 'daytona', 'internal'] as const) {
    assert.equal(toolCallBillableCostUsd(bucket), undefined)
  }
})
