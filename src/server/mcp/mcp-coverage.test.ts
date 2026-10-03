import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { HARNESS_WITHHELD_TOOL_IDS } from '@/server/agents/agent-mcp-tools'
import { AGENT_TOOL_GROUPS } from '@/shared/agents/tool-groups'
import { MCP_EXTERNAL_WITHHELD_TOOL_IDS, MCP_GROUP_COVERAGE, mcpToolGrantFor } from '@/shared/mcp/access'

const groupIds = AGENT_TOOL_GROUPS.map((group) => group.id)

test('every tool group is placed for both MCP surfaces, so a new capability cannot silently miss MCP', () => {
  for (const surface of ['connectedAgents', 'externalApps'] as const) {
    assert.deepEqual(Object.keys(MCP_GROUP_COVERAGE[surface]).sort(), [...groupIds].sort(), surface)
  }
})

test('a withheld group says why', () => {
  for (const [surface, coverage] of Object.entries(MCP_GROUP_COVERAGE)) {
    for (const [group, entry] of Object.entries(coverage)) {
      if (!entry.exposed) assert.ok(entry.reason.length > 20, `${surface}/${group} needs a reason`)
    }
  }
})

test('outside apps: every exposed group reaches the client at Everything, and no withheld group does', () => {
  const full = new Set(mcpToolGrantFor('full'))
  const withheld = new Set([...MCP_EXTERNAL_WITHHELD_TOOL_IDS, ...HARNESS_WITHHELD_TOOL_IDS])
  for (const group of AGENT_TOOL_GROUPS) {
    const entry = MCP_GROUP_COVERAGE.externalApps[group.id]!
    const ids = [...group.toolIds, ...(group.capability ? [`capability:${group.capability}`] : [])]
    if (entry.exposed) {
      // Tools the server withholds on purpose (conversation-bound drafts) are the only gaps inside an exposed group.
      const missing = ids.filter((id) => !full.has(id) && !withheld.has(id))
      assert.deepEqual(missing, [], `${group.id} is exposed but ${missing.join(', ')} are not granted`)
    } else {
      // A tool in the Everything grant is still withheld from outside apps when the server filters it out by id.
      assert.deepEqual(ids.filter((id) => full.has(id) && !withheld.has(id)), [], `${group.id} is withheld but is granted`)
    }
  }
})

test('connected agents: the only tools withheld are the computer group and the UI tool that needs Overlay\'s chat', () => {
  const computer = AGENT_TOOL_GROUPS.find((group) => group.id === 'computer')!
  for (const id of computer.toolIds) assert.ok(HARNESS_WITHHELD_TOOL_IDS.has(id), `${id} should be withheld from connected agents`)
  assert.ok(HARNESS_WITHHELD_TOOL_IDS.has('present_generated_ui'))
  const otherWithheld = [...HARNESS_WITHHELD_TOOL_IDS].filter((id) => !computer.toolIds.includes(id) && id !== 'present_generated_ui')
  assert.deepEqual(otherWithheld, [], 'a new withheld tool needs a reason in MCP_GROUP_COVERAGE')
  for (const [group, entry] of Object.entries(MCP_GROUP_COVERAGE.connectedAgents)) {
    if (group !== 'computer') assert.equal(entry.exposed, true, `${group} should reach connected agents`)
  }
})

test('withheld tool ids are real tools in some group, apart from the generated-UI tool', () => {
  const known = new Set(AGENT_TOOL_GROUPS.flatMap((group) => group.toolIds))
  for (const id of MCP_EXTERNAL_WITHHELD_TOOL_IDS) {
    assert.ok(known.has(id) || id === 'present_generated_ui', `${id} is withheld but belongs to no group`)
  }
})
