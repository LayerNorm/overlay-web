import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { desktopWebShellViolations } from './desktop-web-shell-boundary.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-boundary-'))
  const write = (path, contents) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), contents) }
  write('overlay-desktop/src/main/index.ts', "import { loadWebShell } from './services/web-shell'\n")
  write('src/server/agents/agent-enrollment-command.ts', "export const OVERLAY_AGENT_HOST_PACKAGE_VERSION = '0.4.3'\n")
  write('overlay-desktop/src/main/services/embedded-host-config.ts', "export const EMBEDDED_HOST_PACKAGE_SPEC = '@layernorm/overlay-agent-host@0.4.3'\n")
  write('overlay-desktop/package.json', JSON.stringify({ dependencies: { 'electron-updater': '1' } }))
  const contract = 'export const bridgeVersion = 1\n'
  for (const prefix of ['', 'overlay-desktop/']) {
    write(`${prefix}packages/overlay-desktop-bridge/src/index.ts`, contract)
    write(`${prefix}packages/overlay-desktop-bridge/source.sha256`, createHash('sha256').update(contract).digest('hex'))
  }
  return { root, write }
}

test('native shell requires one exact shared bridge and forbids the duplicate renderer', () => {
  const { root, write } = fixture()
  try {
    assert.deepEqual(desktopWebShellViolations(root), [])
    write('overlay-desktop/src/renderer/src/chat.tsx', 'duplicate renderer')
    assert.ok(desktopWebShellViolations(root).some((message) => message.includes('src/renderer/src must stay retired')))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('bridge drift and provider SDK dependencies fail the boundary', () => {
  const { root, write } = fixture()
  try {
    write('overlay-desktop/packages/overlay-desktop-bridge/src/index.ts', 'different contract')
    write('overlay-desktop/package.json', JSON.stringify({ devDependencies: { '@ai-sdk/openai': '1' } }))
    const failures = desktopWebShellViolations(root)
    assert.ok(failures.some((message) => message.includes('exact canonical bridge')))
    assert.ok(failures.some((message) => message.includes('@ai-sdk/openai')))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
