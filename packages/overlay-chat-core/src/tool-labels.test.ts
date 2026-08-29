import assert from 'node:assert/strict'
import test from 'node:test'
import { getDescriptiveToolLabel } from './tool-labels'

test('MCP tool labels reflect running and terminal lifecycle states', () => {
  const input = { toolName: 'read_tweet' }
  assert.equal(getDescriptiveToolLabel('call_mcp_tool', input), 'Calling MCP tool · read_tweet')
  assert.equal(getDescriptiveToolLabel('call_mcp_tool', input, 'complete'), 'Called MCP tool · read_tweet')
  assert.equal(getDescriptiveToolLabel('call_mcp_tool', input, 'error'), 'MCP tool failed · read_tweet')
  assert.equal(getDescriptiveToolLabel('call_mcp_tool', input, 'denied'), 'MCP tool denied · read_tweet')
})

test('MCP search labels settle after their result is available', () => {
  const input = { query: 'read an exact tweet' }
  assert.equal(
    getDescriptiveToolLabel('search_mcp_tools', input, 'complete'),
    'Searched MCP integrations for “read an exact tweet”',
  )
})
