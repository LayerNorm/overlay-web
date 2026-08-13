import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_TOOL_GROUPS,
  enabledAgentToolGroupIds,
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

test('unknown tool ids do not enable any group', () => {
  assert.equal(enabledAgentToolGroupIds(['perplexity_search', 'not_a_tool']).size, 0)
})

test('every group maps to at least one tool id', () => {
  for (const group of AGENT_TOOL_GROUPS) {
    assert.ok(group.toolIds.length > 0, `${group.id} has no tools`)
  }
})
