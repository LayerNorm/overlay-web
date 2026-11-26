import assert from 'node:assert/strict'
import test from 'node:test'
import { allAgentToolGrantIds } from '@/shared/agents/tool-groups'
import { allowancePeriod, privateThreadFreeGrant } from './private-thread-allowance'

test('the free tier keeps memory, files, notes, tasks, skills and web search from the agent grant, and nothing paid', () => {
  const free = new Set(privateThreadFreeGrant(allAgentToolGrantIds()))
  for (const id of ['search_memory', 'save_memory', 'read_file', 'write_file', 'create_note', 'create_task', 'load_skill', 'capability:web_search']) {
    assert.ok(free.has(id), `${id} is free`)
  }
  for (const id of ['generate_image', 'generate_video', 'create_automation', 'ask_agent', 'capability:integrations', 'capability:mcp', 'computer_exec']) {
    assert.ok(!free.has(id), `${id} is paid`)
  }
})

test('the free tier never widens the agent grant', () => {
  assert.deepEqual(privateThreadFreeGrant(['search_memory', 'generate_image']), ['search_memory'])
  assert.deepEqual(privateThreadFreeGrant([]), [])
})

test('allowances are counted per calendar month in UTC', () => {
  assert.equal(allowancePeriod(Date.UTC(2026, 10, 30, 23, 59)), '2026-11')
  assert.equal(allowancePeriod(Date.UTC(2026, 11, 1, 0, 0)), '2026-12')
})
