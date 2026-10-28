import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod/v3'
import {
  AgentRuntime,
  CompositeContextBuilder,
  FileContextBuilder,
  InMemoryPersistTurn,
  KnowledgeContextBuilder,
  MemoryContextBuilder,
  StaticContextBuilder,
  StoragePersistTurn,
  ToolRegistry,
} from './index'

describe('@overlay/agent-runtime', () => {
  it('validates and executes registered tools', async () => {
    const registry = new ToolRegistry([
      {
        id: 'echo',
        inputSchema: z.object({ text: z.string() }),
        execute: (input) => input,
      },
    ])

    const result = await registry.execute({
      toolId: 'echo',
      input: { text: 'hello' },
    })

    assert.deepEqual(result, { toolId: 'echo', output: { text: 'hello' } })
    assert.throws(() => registry.validateCall({ toolId: 'echo', input: { text: 1 } }), /validation/)
  })

  it('runs a turn with context, exposed tools, and persistence', async () => {
    const persistTurn = new InMemoryPersistTurn()
    const runtime = new AgentRuntime({
      tools: [
        { id: 'allowed', execute: () => 'ok' },
        { id: 'hidden', execute: () => 'nope' },
      ],
      contextBuilder: new StaticContextBuilder({ systemContext: 'known context' }),
      persistTurn,
      executeTurn: async ({ tools, context }) => ({
        text: `${context.systemContext}:${tools.map((tool) => tool.id).join(',')}`,
      }),
    })

    const output = await runtime.runTurn({
      userId: 'user_1',
      turnId: 'turn_1',
      allowedToolIds: ['allowed'],
    })

    assert.equal(output.text, 'known context:allowed')
    assert.equal(output.persisted, true)
    assert.equal(persistTurn.turns.length, 1)
  })

  it('assembles knowledge, memory, and file context sources', async () => {
    const builder = new CompositeContextBuilder([
      new KnowledgeContextBuilder(async () => ({ systemContext: 'knowledge', resources: { k: 1 } })),
      new MemoryContextBuilder(async () => ({ systemContext: 'memory', resources: { m: 2 } })),
      new FileContextBuilder(async () => ({ systemContext: 'files', resources: { f: 3 } })),
    ])

    const context = await builder.build({
      input: { userId: 'user_1', turnId: 'turn_1' },
      tools: [],
    })

    assert.equal(context.systemContext, 'knowledge\n\nmemory\n\nfiles')
    assert.deepEqual(context.resources, { k: 1, m: 2, f: 3 })
    assert.equal(context.metadata?.sourceName, 'files')
  })

  it('persists turns through a storage callback', async () => {
    const records: unknown[] = []
    const persistTurn = new StoragePersistTurn(async (record) => {
      records.push(record)
    })
    const runtime = new AgentRuntime({
      persistTurn,
      executeTurn: async () => ({ text: 'saved' }),
    })

    await runtime.runTurn({ userId: 'user_1', turnId: 'turn_1' })

    assert.equal(records.length, 1)
  })
})
