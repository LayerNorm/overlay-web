import assert from 'node:assert/strict'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
function config(relative) {
  const file = resolve(root, relative)
  const read = ts.readConfigFile(file, ts.sys.readFile)
  assert.equal(read.error, undefined)
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(file))
  assert.equal(parsed.errors.length, 0)
  return { file, ...parsed }
}

test('Convex resolves transitive shared bridge imports from source without package dist', () => {
  const backend = config('convex/tsconfig.json')
  const web = config('tsconfig.json')
  for (const alias of ['@layernorm/overlay-agent-bridge-protocol', '@layernorm/overlay-agent-bridge-protocol/*']) {
    assert.deepEqual(backend.options.paths[alias].map(path => resolve(dirname(backend.file), path)), web.options.paths[alias].map(path => resolve(root, path)))
  }
  const host = { ...ts.sys, fileExists: path => !path.replaceAll('\\', '/').includes('/overlay-agent-bridge-protocol/dist/') && ts.sys.fileExists(path) }
  for (const relative of ['convex/agents/agentDriveMetadata.ts', 'src/shared/agents/agent-drive-manifest.ts', 'src/shared/agents/remote-run-liveness.ts']) {
    const result = ts.resolveModuleName('@layernorm/overlay-agent-bridge-protocol', resolve(root, relative), backend.options, host)
    assert.equal(result.resolvedModule?.resolvedFileName, resolve(root, 'packages/overlay-agent-bridge-protocol/src/index.ts'))
  }
})
