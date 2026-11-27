/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText
  const loaded = { exports: {} }
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})')(
    id => { assert.ok(Object.hasOwn(mocks, id), id); return mocks[id] }, loaded, loaded.exports)
  return loaded.exports
}
test('only the typed 409 denotes workspace setup, never auth or server failures', () => {
  const { isWorkspaceSetupRequired } = load('services/workspaceSetup.ts')
  assert.equal(isWorkspaceSetupRequired({ status: 409, code: 'workspace_setup_required' }), true)
  for (const error of [null, undefined, new Error('workspace_setup_required'), {},
    { status: 500, code: 'workspace_setup_required' }, { status: 401 }, { status: 409, code: 'other' }]) {
    assert.equal(isWorkspaceSetupRequired(error), false)
  }
})
test('session gate renders the approved WorkspaceGate only for setup-required sessions', () => {
  const session = { isInitialized: false, workspaceSetupRequired: true, error: 'Workspace setup required' }
  const WorkspaceGate = () => null
  const react = { createElement: (type, props) => ({ type, props }), useState: () => [null, () => {}] }
  const { SessionGate } = load('components/shell/SessionGate.tsx', {
    react: { ...react, default: react }, 'react-native': { View: 'View', ActivityIndicator: 'Spinner' },
    '../../contexts/AuthContext': { useAuth: () => ({ isAuthenticated: true, signOut: async () => {} }) },
    '../../contexts/AppSessionContext': { useAppSession: () => session },
    '../../hooks/useTheme': { useTheme: () => ({ theme: {} }) },
    './primitives': { Button: 'Button', T: 'T' }, './EntryScreens': { WorkspaceGate },
  })
  assert.equal(SessionGate({ children: 'app' }).type, WorkspaceGate)
  session.workspaceSetupRequired = false
  assert.equal(SessionGate({ children: 'app' }).type, 'View')
})
