/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const babel = require('@babel/core')
const root = path.resolve(__dirname, '..')

function loadNativeKeyboardAvoidingView() {
  const listeners = new Map()
  const keyboard = {
    isVisible: () => false,
    addListener: (event, handler) => {
      listeners.set(event, handler)
      return { remove: () => listeners.delete(event) }
    },
  }
  const mocks = {
    '../../StyleSheet/StyleSheet': { compose: (base, override) => [base, override] },
    '../../Utilities/Platform': { OS: 'android' },
    '../AccessibilityInfo/AccessibilityInfo': {},
    '../../LayoutAnimation/LayoutAnimation': { configureNext() {} },
    '../View/View': 'View',
    './Keyboard': keyboard,
  }
  const filename = require.resolve('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView')
  const { code } = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    plugins: [
      '@babel/plugin-transform-flow-strip-types',
      '@babel/plugin-transform-react-jsx',
      '@babel/plugin-transform-modules-commonjs',
    ],
  })
  const result = { exports: {} }
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
    result,
    result.exports,
  )
  return { AvoidingView: result.exports.default, listeners }
}

function keyboardEnabledFor(file, platform, visible) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const avoiding = elements(source, 'KeyboardAvoidingView').find(node => node.getText().includes('<Composer'))
  const attribute = avoiding.openingElement.attributes.properties.find(item => item.name?.getText() === 'enabled')
  assert.ok(attribute, 'Android keyboard avoidance must explicitly stop when the IME hides')
  return vm.runInNewContext(attribute.initializer.expression.getText(), {
    Platform: { OS: platform }, keyboardVisible: visible,
  })
}

function loadKeyboardLayout() {
  const testModule = { exports: {} }
  const source = fs.readFileSync(path.join(root, 'lib/keyboardLayout.ts'), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(output, { exports: testModule.exports, module: testModule, require })
  return testModule.exports
}

function elements(node, name, result = []) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === name) result.push(node)
  ts.forEachChild(node, child => { elements(child, name, result) })
  return result
}

test('Android explicitly requests resize rather than pan for the native keyboard', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.equal(config.expo.android.softwareKeyboardLayoutMode, 'resize')
})

for (const [file, composer, androidBehavior, webBehavior] of [
  ['components/agents/AgentThreadViews.tsx', 'TextInput', 'height', 'height'],
  ['components/chat/RoomScreen.tsx', 'Composer', 'padding', undefined],
  ['components/chat/ChatScreen.tsx', 'Composer', 'padding', undefined],
]) test(`${file} encloses its composer with native-resize / iOS-padding keyboard handling`, () => {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const avoiding = elements(source, 'KeyboardAvoidingView').find(node => node.getText().includes(`<${composer}`))
  assert.ok(avoiding, 'Composer must be inside KeyboardAvoidingView, not an unprotected sibling')
  const attribute = avoiding.openingElement.attributes.properties.find(item => item.name?.getText() === 'behavior')
  const initializer = attribute.initializer
  const behaviorFor = platform => ts.isStringLiteral(initializer)
    ? initializer.text
    : vm.runInNewContext(initializer.expression.getText(), { Platform: { OS: platform } })
  assert.equal(behaviorFor('android'), androidBehavior)
  assert.equal(behaviorFor('ios'), 'padding')
  assert.equal(behaviorFor('web'), webBehavior)
})

test('composer footer inset follows repeated keyboard show/hide cycles for both chat frames', () => {
  const { getComposerBottomInset, keyboardVisibilityReducer } = loadKeyboardLayout()
  const roomInset = (visible, safeBottom) => getComposerBottomInset(visible, safeBottom, 8, 8)
  const personalInset = (visible, safeBottom, platform = 'android') => getComposerBottomInset(
    visible,
    safeBottom,
    16,
    8,
    platform === 'android' ? 8 : 0,
  )
  let visible = false

  for (let cycle = 0; cycle < 3; cycle += 1) {
    assert.equal(roomInset(visible, 48), 48)
    assert.equal(personalInset(visible, 48), 56)
    assert.equal(personalInset(visible, 48, 'ios'), 48)

    visible = keyboardVisibilityReducer(visible, 'show')
    assert.equal(roomInset(visible, 48), 8)
    assert.equal(personalInset(visible, 48), 8)
    assert.equal(roomInset(visible, 0), 8)
    assert.equal(personalInset(visible, 0), 8)

    visible = keyboardVisibilityReducer(visible, 'hide')
    assert.equal(roomInset(visible, 48), 48)
    assert.equal(personalInset(visible, 48), 56)
    assert.equal(personalInset(visible, 48, 'ios'), 48)
  }
})

for (const file of ['components/chat/RoomScreen.tsx', 'components/chat/ChatScreen.tsx']) {
  test(`${file} clears actual RN padding after a zero-height Android hide event`, async () => {
    const { AvoidingView, listeners } = loadNativeKeyboardAvoidingView()
    const avoiding = new AvoidingView({ behavior: 'padding', enabled: false })
    avoiding.setState = update => { avoiding.state = { ...avoiding.state, ...update } }
    avoiding.componentDidMount()
    const frame = { x: 0, y: 107.80952453613281, width: 411.4285583496094, height: 806.4761962890625 }
    const layout = next => avoiding._onLayout({ persist() {}, nativeEvent: { layout: next } })
    const padding = () => Object.assign({}, ...avoiding.render().props.style).paddingBottom
    const show = { duration: 0, endCoordinates: { screenX: 0, screenY: 577.9047619, width: frame.width, height: 336.3809524 } }
    // Captured on API 35: the hidden IME's zero-height frame ends before the full screen.
    const hide = { duration: 0, endCoordinates: { screenX: 0, screenY: 841.5238037109375, width: frame.width, height: 0 } }
    await layout(frame)
    for (let cycle = 0; cycle < 3; cycle += 1) {
      avoiding.props = { ...avoiding.props, enabled: keyboardEnabledFor(file, 'android', true) }
      listeners.get('keyboardDidShow')(show)
      await Promise.resolve()
      assert.ok(padding() > 330, 'An edge-to-edge frame must lift above the visible IME')
      await layout({ ...frame, height: show.endCoordinates.screenY - frame.y })
      assert.equal(padding(), 0, 'A native-resized frame must not receive a second offset')
      avoiding.props = { ...avoiding.props, enabled: keyboardEnabledFor(file, 'android', false) }
      listeners.get('keyboardDidHide')(hide)
      await layout(frame)
      assert.ok(avoiding._bottom > 72, 'Exercise RN\'s actual residual hide-frame calculation')
      assert.equal(padding(), 0, 'Hidden keyboard must never retain that calculated offset')
    }
    assert.equal(keyboardEnabledFor(file, 'ios', false), true)
    assert.equal(keyboardEnabledFor(file, 'ios', true), true)
    avoiding.componentWillUnmount()
    assert.equal(listeners.size, 0)
  })
}

test('personal chat keeps list drag dismissal without a whole-screen pan responder', () => {
  const source = fs.readFileSync(path.join(root, 'components/chat/ChatScreen.tsx'), 'utf8')
  assert.doesNotMatch(source, /keyboardHeight|keyboardDidShow|keyboardWillShow/)
  assert.doesNotMatch(source, /PanResponder/)
  assert.match(source, /keyboardDismissMode="on-drag"/)
})

test('chat transcripts occupy a bounded flex region without legacy header offsets', () => {
  const personal = fs.readFileSync(path.join(root, 'components/chat/ChatScreen.tsx'), 'utf8')
  const room = fs.readFileSync(path.join(root, 'components/chat/RoomScreen.tsx'), 'utf8')
  assert.match(personal, /threadSurface:\s*\{\s*flex:\s*1,\s*minHeight:\s*0/)
  assert.match(room, /transcriptRegion:\s*\{\s*flex:\s*1,\s*minHeight:\s*0/)
  assert.doesNotMatch(personal, /insets\.top\s*\+\s*70|insets\.top\s*\+\s*64/)
  assert.doesNotMatch(room, /paddingTop:\s*76/)
})
