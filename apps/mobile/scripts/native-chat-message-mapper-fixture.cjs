/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

function loadNativeChatMessageMapper() {
  const cache = new Map()
  function loadFile(relativeFile) {
    const filename = path.resolve(root, relativeFile)
    if (cache.has(filename)) return cache.get(filename).exports
    const loadedModule = { exports: {} }
    cache.set(filename, loadedModule)
    const source = fs.readFileSync(filename, 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
      },
    }).outputText
    const localRequire = (id) => {
      if (id === '@overlay/chat-core') {
        return Object.assign(
          {},
          loadFile('../packages/overlay-chat-core/src/messages.ts'),
          loadFile('../packages/overlay-chat-core/src/transcript-view.ts'),
          loadFile('../packages/overlay-chat-core/src/visual-sequence.ts'),
        )
      }
      if (id.startsWith('react-native') || id.startsWith('expo-') || id.startsWith('convex/')) {
        assert.fail(`Native chat message mapper loaded platform dependency: ${id}`)
      }
      if (!id.startsWith('.')) return require(id)
      const base = path.resolve(path.dirname(filename), id)
      const withoutJs = base.replace(/\.js$/, '')
      const candidate = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        withoutJs,
        `${withoutJs}.ts`,
        `${withoutJs}.tsx`,
      ].find((candidatePath) => fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile())
      assert.ok(candidate, `Could not resolve ${id} from ${filename}`)
      return loadFile(path.relative(root, candidate))
    }
    vm.runInNewContext(
      `(function(require,module,exports){${output}\n})`,
      { console, Error },
    )(localRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }

  return loadFile('lib/toNativeChatMessage.ts')
}

module.exports = { loadNativeChatMessageMapper }
