import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_TOOL_GROUPS, COMPUTER_TOOL_IDS } from '@/shared/agents/tool-groups'
import { MCP_ACCESS_LEVELS, mcpAccessForGrant, mcpToolGrantFor } from './access'

const WRITE_TOOLS = [
  'save_memory', 'save_memory_batch', 'update_memory', 'delete_memory',
  'write_file', 'create_folder', 'move_file',
  'create_note', 'append_to_note', 'replace_note_section', 'edit_note', 'update_note', 'delete_note',
  'draft_skill_from_chat', 'create_automation', 'update_automation', 'pause_automation', 'delete_automation',
  'generate_image', 'generate_video',
]

test('read grants only tools that read, and no capabilities', () => {
  const grant = mcpToolGrantFor('read')
  for (const id of WRITE_TOOLS) assert.equal(grant.includes(id), false, id)
  assert.equal(grant.some((id) => id.startsWith('capability:')), false)
  assert.ok(grant.includes('get_note') && grant.includes('search_memory') && grant.includes('read_file'))
})

test('levels only widen, and no level grants a computer', () => {
  const [read, write, full] = MCP_ACCESS_LEVELS.map((level) => new Set(mcpToolGrantFor(level)))
  for (const id of read!) assert.ok(write!.has(id), `write lacks ${id}`)
  for (const id of write!) assert.ok(full!.has(id), `full lacks ${id}`)
  assert.ok(write!.has('create_note') && write!.has('capability:web_search'))
  assert.equal(write!.has('capability:integrations'), false)
  assert.ok(full!.has('capability:integrations') && full!.has('capability:mcp') && full!.has('create_automation'))
  for (const level of [read!, write!, full!]) for (const id of COMPUTER_TOOL_IDS) assert.equal(level.has(id), false, id)
})

test('no level lets an outside app change agents', () => {
  for (const level of MCP_ACCESS_LEVELS) {
    const grant = mcpToolGrantFor(level)
    assert.equal(grant.includes('create_agent') || grant.includes('update_agent'), false, level)
  }
})

test('every tool id in a level belongs to a known group', () => {
  const known = new Set(AGENT_TOOL_GROUPS.flatMap((group) => group.toolIds))
  for (const level of MCP_ACCESS_LEVELS) {
    for (const id of mcpToolGrantFor(level)) {
      assert.ok(id.startsWith('capability:') || known.has(id), `${id} is not in any tool group`)
    }
  }
})

test('a saved tool grant reads back as the level it matches', () => {
  assert.equal(mcpAccessForGrant([]), 'none')
  for (const level of MCP_ACCESS_LEVELS) assert.equal(mcpAccessForGrant(mcpToolGrantFor(level)), level)
  assert.equal(mcpAccessForGrant(['get_note']), 'custom')
  assert.equal(mcpAccessForGrant([...mcpToolGrantFor('write'), 'create_automation']), 'custom')
})
