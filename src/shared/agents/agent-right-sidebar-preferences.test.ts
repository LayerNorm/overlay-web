import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_AGENT_RIGHT_SIDEBAR_PREFERENCES,
  THREAD_PANEL_MIN_WIDTH,
  parseAgentRightSidebarPreferences,
} from './agent-right-sidebar-preferences'

test('missing or malformed preferences fall back to the default panels', () => {
  assert.deepEqual(parseAgentRightSidebarPreferences(null), DEFAULT_AGENT_RIGHT_SIDEBAR_PREFERENCES)
  assert.deepEqual(parseAgentRightSidebarPreferences('open'), DEFAULT_AGENT_RIGHT_SIDEBAR_PREFERENCES)
})

test('preferences saved before tabs keep the panel open on the matching new panel', () => {
  assert.deepEqual(parseAgentRightSidebarPreferences({ open: true, tab: 'details' }), {
    ...DEFAULT_AGENT_RIGHT_SIDEBAR_PREFERENCES,
    open: true,
    tabs: ['progress', 'computer', 'changes', 'agent'],
    active: 'agent',
  })
  const library = parseAgentRightSidebarPreferences({ open: false, tab: 'library' })
  assert.deepEqual(library.tabs, ['progress', 'computer', 'changes', 'files'])
  assert.equal(library.active, 'files')
  assert.equal(parseAgentRightSidebarPreferences({ tab: 'computer' }).active, 'computer')
})

test('stored tabs drop unknown and repeated panels and keep a valid selection', () => {
  const parsed = parseAgentRightSidebarPreferences({
    open: true, tabs: ['terminal', 'nope', 'terminal', 'library'], active: 'changes', width: 200, expanded: true,
  })
  assert.deepEqual(parsed.tabs, ['terminal', 'files'])
  assert.equal(parsed.active, 'terminal')
  assert.equal(parsed.width, THREAD_PANEL_MIN_WIDTH)
  assert.equal(parsed.expanded, true)
  assert.equal(parseAgentRightSidebarPreferences({ tabs: [] }).active, null)
})
