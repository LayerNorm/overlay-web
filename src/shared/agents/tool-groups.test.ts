import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_TOOL_GROUPS,
  COMPUTER_TOOL_IDS,
  localThreadComputerToolIds,
  AGENT_TOOL_PRESETS,
  agentToolPresetFor,
  agentToolCapabilities,
  agentToolCapabilityGrantId,
  allAgentToolGrantIds,
  DEFAULT_AGENT_TOOL_GROUP_IDS,
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
  assert.equal(normalizeAgentToolGrant(legacy).includes('search_messages'), true)
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

test('Tasks is a default group and legacy broad grants add every task tool', () => {
  const tasks = AGENT_TOOL_GROUPS.find((group) => group.id === 'tasks')!
  assert.equal(tasks.label, 'Tasks')
  assert.equal(tasks.description, 'Create, update, and archive tasks in Work.')
  assert.equal(DEFAULT_AGENT_TOOL_GROUP_IDS.includes('tasks'), true)
  assert.deepEqual(tasks.toolIds, ['list_tasks', 'get_task', 'create_task', 'update_task', 'comment_on_task', 'archive_task', 'restore_task'])
  const legacyGrant = normalizeAgentToolGrant(['create_automation', 'generate_video', 'interactive_browser_session'])
  assert.equal(legacyGrant.includes('interactive_browser_session'), false)
  assert.equal(legacyGrant.includes('computer_browser'), false)
  for (const id of tasks.toolIds) assert.ok(legacyGrant.includes(id), `${id} was not added to a legacy grant`)
})

test('every group grants either tool ids or a capability', () => {
  for (const group of AGENT_TOOL_GROUPS) {
    assert.ok(
      group.toolIds.length > 0 || group.capability,
      `${group.id} grants nothing`,
    )
  }
})

test('the computer group maps to all computer tool ids', () => {
  const computer = AGENT_TOOL_GROUPS.find((g) => g.id === 'computer')!
  assert.deepEqual([...computer.toolIds].sort(), [
    'computer_browser',
    'computer_exec',
    'computer_input',
    'computer_list_files',
    'computer_open_url',
    'computer_publish_file',
    'computer_read_file',
    'computer_screenshot',
    'computer_terminal',
    'computer_write_file',
  ])
  assert.deepEqual(
    [...toolIdsForEnabledGroups(new Set(['computer']))].sort(),
    [...computer.toolIds].sort(),
  )
})

test('the computer group is opt-in — never in the default grant', () => {
  assert.equal(DEFAULT_AGENT_TOOL_GROUP_IDS.includes('computer'), false)
  const grant = toolIdsForEnabledGroups(new Set(DEFAULT_AGENT_TOOL_GROUP_IDS))
  assert.equal(enabledAgentToolGroupIds(grant).has('computer'), false)
})

test('new agents default to every group except computer', () => {
  const expected = AGENT_TOOL_GROUPS.map((group) => group.id).filter((id) => id !== 'computer')
  assert.deepEqual([...DEFAULT_AGENT_TOOL_GROUP_IDS].sort(), expected.sort())
  const grant = toolIdsForEnabledGroups(new Set(DEFAULT_AGENT_TOOL_GROUP_IDS))
  const enabled = enabledAgentToolGroupIds(grant)
  for (const id of expected) assert.ok(enabled.has(id), `default grant missing ${id}`)
})

test('the computer group needs every computer tool id to count as enabled', () => {
  const computer = AGENT_TOOL_GROUPS.find((g) => g.id === 'computer')!
  assert.equal(
    enabledAgentToolGroupIds(computer.toolIds.filter((id) => id !== 'computer_exec')).has('computer'),
    false,
  )
  assert.equal(
    enabledAgentToolGroupIds([...computer.toolIds]).has('computer'),
    true,
  )
})

test('grants saved before a group grew still hold the tools that joined it', () => {
  const beforeNoteEdits = ['list_notes', 'get_note', 'create_note', 'update_note', 'delete_note']
  const beforeFileReads = ['search_knowledge', 'search_in_files']
  const fileEdits = ['write_file', 'create_folder', 'move_file']
  const groups = enabledAgentToolGroupIds([...beforeNoteEdits, ...beforeFileReads, ...fileEdits])
  assert.ok(groups.has('files'), 'old Knowledge + Files + Notes grants read as the merged Files group')
  assert.ok(!enabledAgentToolGroupIds(beforeFileReads).has('files'), 'a search-only grant gains no writes')
  const normalized = normalizeAgentToolGrant(beforeNoteEdits)
  for (const id of ['append_to_note', 'replace_note_section', 'edit_note']) assert.ok(normalized.includes(id))
  assert.ok(!normalizeAgentToolGrant(['get_note']).includes('edit_note'), 'read-only note grants gain no writes')
  const savedComputerGrant = [
    'computer_exec',
    'computer_read_file',
    'computer_write_file',
    'computer_list_files',
    'computer_open_url',
  ]
  assert.ok(normalizeAgentToolGrant(savedComputerGrant).includes('computer_screenshot'))
  assert.ok(normalizeAgentToolGrant(savedComputerGrant).includes('computer_input'))
  assert.ok(normalizeAgentToolGrant(savedComputerGrant).includes('computer_browser'))
  assert.ok(normalizeAgentToolGrant(savedComputerGrant).includes('computer_terminal'))
  assert.ok(normalizeAgentToolGrant(savedComputerGrant).includes('computer_publish_file'))
})

test('tool presets never include computer and are recognised from their groups', () => {
  for (const ids of Object.values(AGENT_TOOL_PRESETS)) assert.equal(ids.includes('computer'), false)
  assert.equal(agentToolPresetFor(new Set(AGENT_TOOL_PRESETS.everything)), 'everything')
  assert.equal(agentToolPresetFor(new Set([...AGENT_TOOL_PRESETS.standard, 'computer'])), 'standard')
  assert.equal(agentToolPresetFor(new Set(['files'])), null)
})

test('a thread on the person’s own computer gets the computer tools; a cloud thread adds none', () => {
  const local = new Set<'local_computer'>(['local_computer'])
  assert.deepEqual(localThreadComputerToolIds({ computer: { kind: 'mac' } }, local), COMPUTER_TOOL_IDS)
  assert.deepEqual(localThreadComputerToolIds({ computer: { kind: 'cloud' } }, local), [])
  assert.deepEqual(localThreadComputerToolIds({}, local), [])
  assert.deepEqual(localThreadComputerToolIds(undefined, local), [])
  // Without the Local computer group the thread's computer is out of reach.
  assert.deepEqual(localThreadComputerToolIds({ computer: { kind: 'mac' } }, new Set()), [])
})

test('Local computer is its own group, on by default and separate from Cloud computer', () => {
  const groups = Object.fromEntries(AGENT_TOOL_GROUPS.map((group) => [group.id, group]))
  assert.equal(groups.computer?.label, 'Cloud computer')
  assert.equal(groups.local_computer?.label, 'Local computer')
  assert.ok(DEFAULT_AGENT_TOOL_GROUP_IDS.includes('local_computer'))
  assert.ok(!DEFAULT_AGENT_TOOL_GROUP_IDS.includes('computer'))
  const localOnly = toolIdsForEnabledGroups(new Set(['local_computer']))
  assert.deepEqual(localOnly, [agentToolCapabilityGrantId('local_computer')])
  assert.deepEqual([...enabledAgentToolGroupIds(localOnly)], ['local_computer'])
  assert.ok(agentToolCapabilities(localOnly).has('local_computer'))
  // The cloud group alone does not let an agent use someone's own computer.
  assert.ok(!agentToolCapabilities(toolIdsForEnabledGroups(new Set(['computer']))).has('local_computer'))
})

test('agents saved with the old Skills grant gain the new skill tools and keep the Skills group', () => {
  const legacy = ['list_skills', 'draft_skill_from_chat']
  const grant = normalizeAgentToolGrant(legacy)
  for (const id of ['find_skills', 'load_skill', 'search_skill_registries', 'save_skill']) {
    assert.equal(grant.includes(id), true, id)
  }
  assert.equal(enabledAgentToolGroupIds(legacy).has('skills'), true)
})

test('related tools share one group: files with notes, images with video, asking with editing agents', () => {
  const groups = Object.fromEntries(AGENT_TOOL_GROUPS.map((group) => [group.id, group]))
  for (const id of ['knowledge', 'notes', 'image', 'video', 'agent_chat']) assert.equal(groups[id], undefined, id)
  for (const id of ['search_knowledge', 'read_file', 'write_file', 'get_note', 'edit_note']) assert.ok(groups.files!.toolIds.includes(id), id)
  for (const id of ['generate_image', 'generate_video', 'edit_video']) assert.ok(groups.media!.toolIds.includes(id), id)
  for (const id of ['ask_agent', 'read_agent_reply', 'create_agent', 'update_agent']) assert.ok(groups.agents!.toolIds.includes(id), id)
  const everyTool = AGENT_TOOL_GROUPS.flatMap((group) => group.toolIds)
  assert.equal(new Set(everyTool).size, everyTool.length, 'no tool belongs to two groups')
})
