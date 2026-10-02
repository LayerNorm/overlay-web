import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { createMcpApprovalGate, mcpApprovalPrompt, mcpApprovalRequestKey } from './mcp-approval-gate'

type State = { state: 'pending' | 'resolved' | 'unavailable'; decision?: string }

function gateWith(script: State[], options: { waitMs?: number } = {}) {
  let clock = 0
  const asks: Array<{ requestKey: string; prompt: string }> = []
  const gate = createMcpApprovalGate({
    repository: {
      requestMcpApproval: async (args) => {
        asks.push({ requestKey: args.requestKey, prompt: args.prompt })
        return script[Math.min(asks.length - 1, script.length - 1)]!
      },
    },
    workspaceId: 'ws', environmentId: 'env', runId: 'run',
    now: () => clock,
    sleep: async (ms) => { clock += ms },
    ...(options.waitMs !== undefined ? { waitMs: options.waitMs } : {}),
  })
  return { gate, asks, elapsed: () => clock }
}

test('the same tool with the same arguments is one request, in any key order', () => {
  assert.equal(mcpApprovalRequestKey('call_mcp_tool', { a: 1, b: { y: 2, x: 1 } }), mcpApprovalRequestKey('call_mcp_tool', { b: { x: 1, y: 2 }, a: 1 }))
  assert.notEqual(mcpApprovalRequestKey('call_mcp_tool', { a: 1 }), mcpApprovalRequestKey('call_mcp_tool', { a: 2 }))
  assert.notEqual(mcpApprovalRequestKey('call_mcp_tool', { a: 1 }), mcpApprovalRequestKey('other_tool', { a: 1 }))
  assert.match(mcpApprovalRequestKey('t', {}), /^mcp:[0-9a-f]{24}$/)
})

test('the prompt names the tool and shortens long arguments', () => {
  assert.equal(mcpApprovalPrompt('delete_repo', {}), 'Allow the agent to run delete_repo?')
  assert.match(mcpApprovalPrompt('delete_repo', { name: 'x' }), /delete_repo\? \{"name":"x"\}/)
  assert.ok(mcpApprovalPrompt('t', { text: 'z'.repeat(2_000) }).length < 300)
})

test('an answer given while the call waits lets it run', async () => {
  const { gate, asks } = gateWith([{ state: 'pending' }, { state: 'pending' }, { state: 'resolved', decision: 'allow' }])
  assert.deepEqual(await gate('call_mcp_tool', { a: 1 }), { allowed: true })
  assert.equal(asks.length, 3)
  assert.equal(new Set(asks.map((ask) => ask.requestKey)).size, 1)
})

test('a denial refuses, and says not to retry', async () => {
  const outcome = await gateWith([{ state: 'resolved', decision: 'deny' }]).gate('call_mcp_tool', {})
  assert.equal(outcome.allowed, false)
  assert.match('message' in outcome ? outcome.message : '', /did not allow call_mcp_tool.*Do not retry/)
})

test('a run that ended while waiting refuses, and a request on an ended run is refused', async () => {
  const ended = await gateWith([{ state: 'resolved', decision: 'cancelled' }]).gate('call_mcp_tool', {})
  assert.match(ended.allowed === false ? ended.message : '', /run ended first/)
  const gone = await gateWith([{ state: 'unavailable' }]).gate('call_mcp_tool', {})
  assert.match(gone.allowed === false ? gone.message : '', /can no longer ask/)
})

test('an unanswered request stops waiting and tells the agent to call again, not to give up', async () => {
  const { gate, elapsed } = gateWith([{ state: 'pending' }], { waitMs: 6_000 })
  const outcome = await gate('call_mcp_tool', { a: 1 })
  assert.equal(outcome.allowed, false)
  assert.match(outcome.allowed === false ? outcome.message : '', /call call_mcp_tool again with the same arguments/)
  assert.ok(elapsed() >= 6_000 && elapsed() < 8_000, `waited ${elapsed()}ms`)
})
