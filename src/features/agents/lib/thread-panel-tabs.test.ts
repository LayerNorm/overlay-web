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
  const changes = replaceLauncher(launched, 'new:1', 'changes')
  assert.deepEqual(changes.tabs.map((tab) => tab.id), ['progress', 'computer', 'changes'])
  assert.equal(changes.active, 'changes')
  const existing = replaceLauncher(launched, 'new:1', 'computer')
  assert.deepEqual(existing.tabs.map((tab) => tab.id), ['progress', 'computer'])
  assert.equal(existing.active, 'computer')
})

test('closing selects the left neighbour and the last close returns to the home', () => {
  const closed = closeTab(selectTab(start, 'computer'), 'computer')
  assert.equal(closed.active, 'progress')
  const empty = closeTab(closed, 'progress')
  assert.deepEqual(empty, { tabs: [], active: null })
  assert.equal(activeTab(empty), null)
  assert.equal(closeTab(start, 'missing'), start)
})

test('only panels are remembered and file tabs close when the thread changes', () => {
  const state = openLauncher(openFile(start, 'f1'), 'new:5')
  assert.deepEqual(panelsOf(state), { tabs: ['progress', 'computer'], active: null })
  assert.deepEqual(panelsOf(selectTab(state, 'computer')), { tabs: ['progress', 'computer'], active: 'computer' })
  const switched = withoutFileTabs(selectTab(state, 'file:f1'))
  assert.deepEqual(switched.tabs.map((tab) => tab.id), ['progress', 'computer', 'new:5'])
  assert.equal(switched.active, 'computer')
})
