import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_TOOL_GROUPS,
  agentToolCapabilities,
  agentToolCapabilityGrantId,
  allAgentToolGrantIds,
  enabledAgentToolGroupIds,
  normalizeAgentToolGrant,
  overlayToolIdsFromGrant,
  toolIdsForEnabledGroups,
} from './tool-groups'

test('a group counts as enabled only when all its tool ids are granted', () => {
  const memory = AGENT_TOOL_GROUPS.find((g) => g.id === 'memory')!
  const partial = memory.toolIds.slice(0, 1)
  assert.equal(enabledAgentToolGroupIds(partial).has('memory'), false)
  assert.equal(enabledAgentToolGroupIds([...memory.toolIds]).has('memory'), true)
})

test('round-trips: enabling groups then reading them back is stable', () => {
  const groups = new Set(['memory', 'skills'])
  const toolIds = toolIdsForEnabledGroups(groups)
  const readBack = enabledAgentToolGroupIds(toolIds)
  assert.deepEqual([...readBack].sort(), ['memory', 'skills'])
})

test('capability groups round-trip the same way tool-id groups do', () => {
  const groups = new Set(['web_search', 'mcp'])
  const grant = toolIdsForEnabledGroups(groups)
  assert.deepEqual([...enabledAgentToolGroupIds(grant)].sort(), ['mcp', 'web_search'])
  assert.deepEqual([...agentToolCapabilities(grant)].sort(), ['mcp', 'web_search'])
})

test('a capability the agent was not granted is not reported', () => {
  const grant = toolIdsForEnabledGroups(new Set(['web_search']))
  assert.equal(agentToolCapabilities(grant).has('integrations'), false)
})

test('capability grants are not mistaken for overlay tool ids', () => {
  const grant = toolIdsForEnabledGroups(new Set(['memory', 'web_search']))
  assert.equal(overlayToolIdsFromGrant(grant).includes(agentToolCapabilityGrantId('web_search')), false)
  assert.equal(overlayToolIdsFromGrant(grant).includes('save_memory'), true)
})

test('a memory grant saved before recall existed still counts as memory', () => {
  const legacy = ['save_memory', 'save_memory_batch', 'update_memory', 'delete_memory']
  assert.equal(enabledAgentToolGroupIds(legacy).has('memory'), true)
  assert.equal(normalizeAgentToolGrant(legacy).includes('search_memory'), true)
})

test('normalization does not invent a memory grant that was never given', () => {
  assert.deepEqual(normalizeAgentToolGrant(['list_notes']), ['list_notes'])
})

test('unknown tool ids do not enable any group', () => {
  assert.equal(enabledAgentToolGroupIds(['not_a_tool', 'also_not_a_tool']).size, 0)
})

test('a full grant enables every group', () => {
  assert.equal(enabledAgentToolGroupIds(allAgentToolGrantIds()).size, AGENT_TOOL_GROUPS.length)
})

test('every group grants either tool ids or a capability', () => {
  for (const group of AGENT_TOOL_GROUPS) {
    assert.ok(
      group.toolIds.length > 0 || group.capability,
      `${group.id} grants nothing`,
    )
  }
})
