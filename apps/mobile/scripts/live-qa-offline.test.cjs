/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

test('offline banner has bounded wrapping text, unscaled icon and no line or height cap', () => {
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }
  react.default = react
  const mocks = { react, 'react-native': { View: 'View' }, 'lucide-react-native': { WifiOff: 'Icon' }, './Brand': {}, './primitives': { T: 'Text' } }
  const loaded = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../components/shell/EntryScreens.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})')(id => mocks[id], loaded, loaded.exports)
  const tree = loaded.exports.OfflineBanner({ theme: {} })
  const [icon, text] = tree.props.children
  assert.equal(tree.props.accessibilityRole, 'alert')
  assert.equal(icon.props.style.flexShrink, 0)
  assert.equal(text.props.children.join(''), 'Offline. Changes sync when you reconnect.')
  assert.equal(text.props.style.flex, 1)
  assert.equal(text.props.style.flexShrink, 1)
  assert.equal(text.props.numberOfLines, undefined)
  assert.equal(text.props.allowFontScaling, undefined)
  assert.equal(tree.props.style.height, undefined)
  assert.equal(tree.props.style.maxHeight, undefined)
})
