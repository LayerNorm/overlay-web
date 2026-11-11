/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function elements(node, name, result = []) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === name) result.push(node)
  ts.forEachChild(node, child => { elements(child, name, result) })
  return result
}

test('Android explicitly requests resize rather than pan for the native keyboard', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.equal(config.expo.android.softwareKeyboardLayoutMode, 'resize')
})

for (const [file, composer, androidBehavior] of [
  ['components/agents/AgentThreadViews.tsx', 'TextInput', 'height'],
  ['components/chat/RoomScreen.tsx', 'Composer', undefined],
  ['components/chat/ChatScreen.tsx', 'Composer', undefined],
]) test(`${file} encloses its composer with native-resize / iOS-padding keyboard handling`, () => {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const avoiding = elements(source, 'KeyboardAvoidingView').find(node => node.getText().includes(`<${composer}`))
  assert.ok(avoiding, 'Composer must be inside KeyboardAvoidingView, not an unprotected sibling')
  const attribute = avoiding.openingElement.attributes.properties.find(item => item.name?.getText() === 'behavior')
  const expression = attribute.initializer.expression.getText()
  assert.equal(vm.runInNewContext(expression, { Platform: { OS: 'android' } }), androidBehavior)
  assert.equal(vm.runInNewContext(expression, { Platform: { OS: 'ios' } }), 'padding')
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
