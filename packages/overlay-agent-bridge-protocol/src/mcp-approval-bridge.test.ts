import assert from 'node:assert/strict'
import test from 'node:test'
import { createMcpApprovalBridge, verifyMcpApprovalBridge } from './mcp-approval-bridge.js'

const callId = 'd3c2acb6-f09a-4ec6-97eb-39fad2eed724'
const correlation = { callId, requestKey: `mcp_call:${callId}` }
const schema = (proof: string) => ({ type: 'object', properties: { confirm: { type: 'boolean' }, overlay_request: { type: 'string', enum: [proof] } } })

test('approval correlation is authenticated with this run’s private MCP token', async () => {
  const proof = await createMcpApprovalBridge('private-fixture-token', correlation)
  assert.deepEqual(await verifyMcpApprovalBridge('private-fixture-token', schema(proof)), correlation)
  assert.equal(await verifyMcpApprovalBridge('different-run-token', schema(proof)), null)
  assert.equal(await verifyMcpApprovalBridge('private-fixture-token', schema(`${proof}x`)), null)
})

test('ordinary forms and malformed correlation cannot suppress an approval card', async () => {
  for (const value of [null, {}, schema('invalid'), schema('a.b.c')]) assert.equal(await verifyMcpApprovalBridge('token', value), null)
  await assert.rejects(createMcpApprovalBridge('token', { ...correlation, requestKey: 'mcp_call:unrelated' }))
})
