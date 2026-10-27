import { expect, test } from 'vitest'
import { HARNESS_READ_ONLY_TOOL_IDS, harnessToolsRequirePlan } from './write-tools'

test('read-only tools do not require a plan, while writes and unknown tools do', () => {
  expect([...HARNESS_READ_ONLY_TOOL_IDS]).toEqual([
    'deep_search',
    'get_note',
    'get_task',
    'list_agents',
    'list_automations',
    'list_chats',
    'list_files',
    'list_notes',
    'list_skills',
    'list_tasks',
    'read_agent_reply',
    'read_chat',
    'read_file',
    'search_in_files',
    'search_knowledge',
    'search_memory',
    'search_messages',
    'web_fetch',
    'web_search',
    'present_generated_ui',
  ])
  expect(harnessToolsRequirePlan(['read_file', 'search_memory', 'present_generated_ui'])).toBe(false)
  expect(harnessToolsRequirePlan([])).toBe(false)
  expect(harnessToolsRequirePlan(['ask_agent'])).toBe(true)
  expect(harnessToolsRequirePlan(['post_message'])).toBe(true)
  expect(harnessToolsRequirePlan(['draft_note'])).toBe(true)
  expect(harnessToolsRequirePlan(['write_memory'])).toBe(true)
  expect(harnessToolsRequirePlan(['future_tool'])).toBe(true)
})
