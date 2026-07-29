import assert from 'node:assert/strict'
import test from 'node:test'
import { scopeIntegrationToolSet } from './runtime'

function tool(executions: unknown[]) {
  return {
    execute: async (input: unknown) => {
      executions.push(input)
      return { ok: true }
    },
  } as never
}

test('project connector scope inherits when unset and disables on an explicit empty list', () => {
  const tools = { COMPOSIO_EXECUTE_TOOL: tool([]) }
  assert.equal(scopeIntegrationToolSet(tools), tools)
  assert.deepEqual(scopeIntegrationToolSet(tools, []), {})
})

test('project connector scope requires an allowed connector in dynamic tool input', async () => {
  const executions: unknown[] = []
  const scoped = scopeIntegrationToolSet(
    { COMPOSIO_EXECUTE_TOOL: tool(executions) },
    ['gmail'],
  )
  const execute = scoped.COMPOSIO_EXECUTE_TOOL?.execute
  assert.equal(typeof execute, 'function')

  await assert.rejects(
    () => execute!({ app: 'slack', action: 'send' }, {} as never),
    /only permits these connectors: gmail/,
  )
  await execute!({ app: 'gmail', action: 'search' }, {} as never)
  assert.deepEqual(executions, [{ app: 'gmail', action: 'search' }])
})
