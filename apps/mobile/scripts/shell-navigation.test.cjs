/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../lib/shellNavigation.ts'), 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const loaded = { exports: {} }
vm.runInNewContext(output, { exports: loaded.exports, module: loaded })
const { shellPanelForPathname, transitionShellPanelSelection } = loaded.exports
const assertSelection = (selection, pathname, panel) => {
  assert.equal(selection.pathname, pathname)
  assert.equal(selection.panel, panel)
}

test('shell panel follows semantic chat, channel, thread, agent, and dm routes', () => {
  assert.deepEqual(
    ['/chat', '/chat/123', '/channel/123', '/thread/123', '/agents', '/agent/123', '/dm/123'].map(shellPanelForPathname),
    ['chat', 'chat', 'chat', 'chat', 'agents', 'agents', 'agents'],
  )
})

test('unknown and similarly prefixed routes do not select a panel', () => {
  assert.equal(shellPanelForPathname('/chatty'), null)
  assert.equal(shellPanelForPathname('/channels'), null)
  assert.equal(shellPanelForPathname('/settings'), null)
  assert.equal(shellPanelForPathname('/'), null)
})

test('navigation advances the remembered path and unknown sections retain the latest panel', () => {
  let selection = { pathname: '/chat', panel: 'chat' }
  selection = transitionShellPanelSelection(selection, '/agents')
  assertSelection(selection, '/agents', 'agents')
  selection = transitionShellPanelSelection(selection, '/settings')
  assertSelection(selection, '/settings', 'agents')
  selection = transitionShellPanelSelection(selection, '/chat')
  assertSelection(selection, '/chat', 'chat')
})

test('a manual Agents choice on a channel lasts until navigation', () => {
  let selection = transitionShellPanelSelection({ pathname: '/settings', panel: 'agents' }, '/channel/1')
  assertSelection(selection, '/channel/1', 'chat')
  selection = { pathname: '/channel/1', panel: 'agents' }
  assert.equal(transitionShellPanelSelection(selection, '/channel/1'), selection)
  selection = transitionShellPanelSelection(selection, '/settings')
  assertSelection(selection, '/settings', 'agents')
  selection = transitionShellPanelSelection(selection, '/thread/2')
  assertSelection(selection, '/thread/2', 'chat')
})
