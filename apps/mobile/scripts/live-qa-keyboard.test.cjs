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

for (const [file, composer] of [
  ['components/agents/AgentThreadViews.tsx', 'TextInput'],
  ['components/chat/RoomScreen.tsx', 'Composer'],
  ['components/chat/ChatScreen.tsx', 'Composer'],
]) test(`${file} encloses its composer in Android height / iOS padding keyboard avoidance`, () => {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const avoiding = elements(source, 'KeyboardAvoidingView').find(node => node.getText().includes(`<${composer}`))
  assert.ok(avoiding, 'Composer must be inside KeyboardAvoidingView, not an unprotected sibling')
  const attribute = avoiding.openingElement.attributes.properties.find(item => item.name?.getText() === 'behavior')
  const expression = attribute.initializer.expression.getText()
  assert.equal(vm.runInNewContext(expression, { Platform: { OS: 'android' } }), 'height')
  assert.equal(vm.runInNewContext(expression, { Platform: { OS: 'ios' } }), 'padding')
})

test('personal chat does not add a second keyboard-sized spacer after the native window resizes', () => {
  const source = fs.readFileSync(path.join(root, 'components/chat/ChatScreen.tsx'), 'utf8')
  assert.doesNotMatch(source, /keyboardHeight|keyboardDidShow|keyboardWillShow/)
})
