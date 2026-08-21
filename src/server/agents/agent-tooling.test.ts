import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAgentGrant } from './agent-tooling'
import { agentModelAttempts, buildAgentSystemPrompt } from './workspace-agent-invocation'
import {
  AGENT_TOOL_GROUPS,
  allAgentToolGrantIds,
  toolIdsForEnabledGroups,
} from '@/shared/agents/tool-groups'
import { FREE_TIER_AUTO_MODEL_ID } from '@/shared/ai/gateway/model-types'

test('the default master agent holds every grant without enumerating them', () => {
  const grant = resolveAgentGrant({ agentId: 'a1', allowedToolIds: [], isDefaultMaster: true })
  assert.equal(grant.capabilities.has('web_search'), true)
  assert.equal(grant.capabilities.has('integrations'), true)
  assert.equal(grant.capabilities.has('mcp'), true)
  assert.equal(grant.overlayToolIds.includes('search_memory'), true)
  assert.equal(grant.overlayToolIds.includes('run_daytona_sandbox'), true)
})

test('an explicit grant on the master agent is honoured over the implicit one', () => {
  const grant = resolveAgentGrant({
    agentId: 'a1',
    allowedToolIds: toolIdsForEnabledGroups(new Set(['memory'])),
    isDefaultMaster: true,
  })
  assert.equal(grant.capabilities.size, 0)
  assert.equal(grant.overlayToolIds.includes('run_daytona_sandbox'), false)
})

test('a narrow grant yields only what it names', () => {
  const grant = resolveAgentGrant({
    agentId: 'a2',
    allowedToolIds: toolIdsForEnabledGroups(new Set(['notes', 'web_search'])),
    isDefaultMaster: false,
  })
  assert.deepEqual([...grant.capabilities], ['web_search'])
  assert.equal(grant.overlayToolIds.includes('create_note'), true)
  assert.equal(grant.overlayToolIds.includes('save_memory'), false)
})

test('an agent with no grant gets nothing', () => {
  const grant = resolveAgentGrant({ agentId: 'a3', allowedToolIds: [], isDefaultMaster: false })
  assert.equal(grant.capabilities.size, 0)
  assert.deepEqual(grant.overlayToolIds, [])
})

test('capability grants never leak into the overlay tool-id list', () => {
  const grant = resolveAgentGrant({
    agentId: 'a4',
    allowedToolIds: allAgentToolGrantIds(),
    isDefaultMaster: false,
  })
  for (const toolId of grant.overlayToolIds) {
    assert.ok(!toolId.startsWith('capability:'), `${toolId} is a capability grant, not a tool id`)
  }
  const capabilityGroups = AGENT_TOOL_GROUPS.filter((group) => group.capability)
  assert.equal(grant.capabilities.size, capabilityGroups.length)
})

test('a paid model falls back to the free router when the payer cannot reach it', () => {
  assert.deepEqual(agentModelAttempts('claude-sonnet-4-6'), [
    'claude-sonnet-4-6',
    FREE_TIER_AUTO_MODEL_ID,
  ])
})

test('a free model has nothing to fall back to and is attempted once', () => {
  assert.deepEqual(agentModelAttempts(FREE_TIER_AUTO_MODEL_ID), [FREE_TIER_AUTO_MODEL_ID])
})

test('the recall instruction is only given when recall is actually available', () => {
  const base = {
    agentName: 'Overlay',
    contextBlock: '',
    hasTools: true,
    instructions: 'Be helpful.',
    isDefaultMaster: false,
  }
  assert.match(
    buildAgentSystemPrompt({ ...base, exposedToolIds: ['search_memory'] }),
    /call search_memory/,
  )
  assert.doesNotMatch(
    buildAgentSystemPrompt({ ...base, exposedToolIds: ['list_notes'] }),
    /search_memory/,
  )
})

test('an agent with no tools is told so rather than encouraged to use them', () => {
  const prompt = buildAgentSystemPrompt({
    agentName: 'Overlay',
    contextBlock: '',
    exposedToolIds: [],
    hasTools: false,
    instructions: 'Be helpful.',
    isDefaultMaster: false,
  })
  assert.match(prompt, /no tools or resource access/)
})
