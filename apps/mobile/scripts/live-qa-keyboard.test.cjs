/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

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

test('keyboard padding geometry leaves zero residual overlap after resize and resets on hide', () => {
  const keyboardTop = 600
  const residualPadding = (frameY, frameHeight, imeTop) => imeTop === null
    ? 0
    : Math.max(0, frameY + frameHeight - imeTop)

  assert.equal(residualPadding(80, 520, keyboardTop), 0)
  assert.equal(residualPadding(80, 920, keyboardTop), 400)
  assert.equal(residualPadding(80, 920, null), 0)
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
