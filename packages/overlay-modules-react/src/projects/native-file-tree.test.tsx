import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNativeProjectFileTree } from './native-file-tree'

test('native project paths use the shared sorted tree contract', () => {
  const tree = buildNativeProjectFileTree([
    './src/zeta.ts',
    'README.md',
    'src/components/Button.tsx',
    'src/alpha.ts',
  ])
  assert.deepEqual(tree.map((node) => [node.name, node.type]), [
    ['src', 'directory'],
    ['README.md', 'file'],
  ])
  assert.deepEqual(tree[0]?.children.map((node) => node.name), [
    'components',
    'alpha.ts',
    'zeta.ts',
  ])
  assert.equal(tree[0]?.children[0]?.children[0]?.relativePath, 'src/components/Button.tsx')
})
