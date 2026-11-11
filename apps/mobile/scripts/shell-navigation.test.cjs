/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const rendererRequire = createRequire(require.resolve('react-test-renderer'))
const React = rendererRequire('react')
const { act, create } = rendererRequire('react-test-renderer')

const source = fs.readFileSync(path.join(__dirname, '../lib/shellNavigation.ts'), 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const loaded = { exports: {} }
vm.runInNewContext(output, { exports: loaded.exports, module: loaded })
const { shellPanelForPathname, transitionShellPanelSelection } = loaded.exports

let activePathname = '/'
let keyboardDismissals = 0
const drawerSource = fs.readFileSync(path.join(__dirname, '../contexts/DrawerContext.tsx'), 'utf8')
const drawerOutput = ts.transpileModule(drawerSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText
const drawerModule = { exports: {} }
const drawerRequire = (specifier) => {
  if (specifier === 'react') return React
  if (specifier === 'react/jsx-runtime') return rendererRequire('react/jsx-runtime')
  if (specifier === 'react-native') {
    return {
      Keyboard: { dismiss: () => { keyboardDismissals += 1 } },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
    }
  }
  if (specifier === 'expo-router') return { usePathname: () => activePathname }
  if (specifier === '../lib/shellNavigation') return loaded.exports
  throw new Error(`Unexpected DrawerContext import: ${specifier}`)
}
vm.runInNewContext(drawerOutput, {
  exports: drawerModule.exports,
  module: drawerModule,
  require: drawerRequire,
})
const { DrawerProvider, useDrawer } = drawerModule.exports
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

test('the drawer provider preserves panel selection across close/reopen and tracks route changes', async () => {
  const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  keyboardDismissals = 0
  let renderer

  function DrawerProbe() {
    const drawer = useDrawer()
    return React.createElement('drawer-probe', {
      panel: drawer.shellPanel,
      visible: drawer.drawerVisible,
      open: drawer.openDrawer,
      close: drawer.closeDrawer,
      selectPanel: drawer.selectShellPanel,
    })
  }

  function RoutedDrawer({ pathname }) {
    activePathname = pathname
    return React.createElement(DrawerProvider, null, React.createElement(DrawerProbe))
  }

  const state = () => renderer.root.findByType('drawer-probe').props
  const renderPath = (pathname) => React.createElement(RoutedDrawer, { pathname })

  try {
    await act(async () => { renderer = create(renderPath('/channel/1')) })
    assert.equal(state().panel, 'chat')

    await act(async () => { state().open() })
    await act(async () => { state().selectPanel('agents') })
    await act(async () => { state().close() })
    assert.equal(state().visible, false)
    await act(async () => { state().open() })
    assert.equal(state().visible, true)
    assert.equal(state().panel, 'agents')
    assert.equal(keyboardDismissals, 2)

    await act(async () => {
      state().close()
      renderer.update(renderPath('/thread/2'))
    })
    assert.equal(state().visible, false)
    assert.equal(state().panel, 'chat')
    await act(async () => { renderer.update(renderPath('/agent/7')) })
    assert.equal(state().panel, 'agents')
    await act(async () => { renderer.update(renderPath('/dm/7')) })
    assert.equal(state().panel, 'agents')

    await act(async () => { renderer.update(renderPath('/settings')) })
    assert.equal(state().panel, 'agents')
    await act(async () => { state().selectPanel('chat') })
    await act(async () => { renderer.update(renderPath('/help')) })
    assert.equal(state().panel, 'chat')
    await act(async () => { state().open() })
    assert.equal(state().panel, 'chat')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    if (previousActEnvironment) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  }
})
