import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeTab,
  closeTab,
  openFile,
  openLauncher,
  openPanel,
  panelsOf,
  replaceLauncher,
  selectTab,
  tabsFromPanels,
  withoutFileTabs,
} from './thread-panel-tabs'

const start = tabsFromPanels(['progress', 'computer'], 'progress')

test('an open panel or file is focused instead of opened twice', () => {
  const computer = openPanel(start, 'computer')
  assert.equal(computer.tabs.length, 2)
  assert.equal(computer.active, 'computer')
  const file = openFile(openFile(start, 'f1'), 'f1')
  assert.deepEqual(file.tabs.map((tab) => tab.id), ['progress', 'computer', 'file:f1'])
  assert.equal(file.active, 'file:f1')
})

test('a launcher becomes the panel picked from it, or closes when that panel is already open', () => {
  const launched = openLauncher(start, 'new:1')
  const terminal = replaceLauncher(launched, 'new:1', 'terminal')
  assert.deepEqual(terminal.tabs.map((tab) => tab.id), ['progress', 'computer', 'terminal'])
  assert.equal(terminal.active, 'terminal')
  const existing = replaceLauncher(launched, 'new:1', 'computer')
  assert.deepEqual(existing.tabs.map((tab) => tab.id), ['progress', 'computer'])
  assert.equal(existing.active, 'computer')
})

test('closing selects the left neighbour and the last close leaves a launcher', () => {
  const closed = closeTab(selectTab(start, 'computer'), 'computer', 'new:2')
  assert.equal(closed.active, 'progress')
  const empty = closeTab(closed, 'progress', 'new:3')
  assert.deepEqual(empty.tabs, [{ id: 'new:3', kind: 'new' }])
  assert.equal(activeTab(empty)?.kind, 'new')
  assert.equal(closeTab(start, 'missing', 'new:4'), start)
})

test('only panels are remembered and file tabs close when the thread changes', () => {
  const state = openLauncher(openFile(start, 'f1'), 'new:5')
  assert.deepEqual(panelsOf(state), { tabs: ['progress', 'computer'], active: null })
  assert.deepEqual(panelsOf(selectTab(state, 'computer')), { tabs: ['progress', 'computer'], active: 'computer' })
  const switched = withoutFileTabs(selectTab(state, 'file:f1'), 'new:6')
  assert.deepEqual(switched.tabs.map((tab) => tab.id), ['progress', 'computer', 'new:5'])
  assert.equal(switched.active, 'computer')
})
