import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { desktopWebShellViolations } from './desktop-web-shell-boundary.mjs'

const BRIDGE_DEPENDENCY = {
  '@overlay/desktop-bridge': 'file:../../packages/overlay-desktop-bridge',
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-boundary-'))
  const write = (path, contents) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), contents)
  }
  write(
    'apps/desktop/src/main/index.ts',
    "import { loadWebShell } from './services/web-shell'\n",
  )
  write(
    'src/server/agents/agent-enrollment-command.ts',
    "export const OVERLAY_AGENT_HOST_PACKAGE_VERSION = '0.4.3'\n",
  )
  write(
    'apps/desktop/agent-host-bundle/package.json',
    JSON.stringify({
      dependencies: { '@layernorm/overlay-agent-host': '0.4.3' },
    }),
  )
  write(
    'apps/desktop/package.json',
    JSON.stringify({ dependencies: BRIDGE_DEPENDENCY }),
  )
  write('packages/overlay-desktop-bridge/src/index.ts', 'export const bridgeVersion = 1\n')
  return { root, write }
}

test('native shell requires one exact shared bridge and forbids the duplicate renderer', () => {
  const { root, write } = fixture()
  try {
    assert.deepEqual(desktopWebShellViolations(root), [])
    write('apps/desktop/src/renderer/src/chat.tsx', 'duplicate renderer')
    assert.ok(
      desktopWebShellViolations(root).some((message) =>
        message.includes('src/renderer/src must stay retired'),
      ),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('a copied bridge, an unlinked bridge and provider SDKs fail the boundary', () => {
  const { root, write } = fixture()
  try {
    write(
      'apps/desktop/packages/overlay-desktop-bridge/src/index.ts',
      'copied contract',
    )
    write(
      'apps/desktop/package.json',
      JSON.stringify({ devDependencies: { '@ai-sdk/openai': '1' } }),
    )
    const failures = desktopWebShellViolations(root)
    assert.ok(
      failures.some((message) => message.includes('must not vendor overlay-desktop-bridge')),
    )
    assert.ok(
      failures.some((message) => message.includes('shared bridge package')),
    )
    assert.ok(failures.some((message) => message.includes('@ai-sdk/openai')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
