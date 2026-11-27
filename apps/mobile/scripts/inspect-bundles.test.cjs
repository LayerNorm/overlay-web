/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { inspectExport } = require('./inspect-bundles.cjs')

function withExport(files, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inspect-bundles-'))
  try {
    for (const [name, contents] of Object.entries(files)) {
      fs.writeFileSync(path.join(root, name), contents)
    }
    callback(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('bundle inspection rejects the prior shared Markdown route and synthetic transcript fixture', () => {
  const bundleMap = {
    version: 3,
    file: 'index.js',
    sources: [
      '../app/dev/shared-markdown.tsx',
      '../../components/chat/SharedTranscriptProofMode.tsx',
    ],
    sourcesContent: [
      "import { SharedTranscriptProofMode } from '../../components/chat/SharedTranscriptProofMode'",
      "const workspaceId = 'shared-transcript-proof-workspace'",
    ],
  }

  withExport({
    'index.js': "const workspaceId = 'shared-transcript-proof-workspace'",
    'index.js.map': JSON.stringify(bundleMap),
  }, (root) => {
    assert.throws(() => inspectExport(root), (error) => {
      assert.match(error.message, /synthetic shared Markdown fixture patterns found/)
      assert.match(error.message, /shared-markdown-route/)
      assert.match(error.message, /shared-transcript-proof-component/)
      assert.match(error.message, /shared-transcript-workspace-marker/)
      return true
    })
  })
})

test('bundle inspection allows ordinary production proof terminology', () => {
  const bundleMap = {
    version: 3,
    file: 'index.js',
    sources: ['../app/chat/index.tsx', '../components/chat/ChatScreen.tsx'],
    sourcesContent: [
      "export const stateDescription = 'reply proof state'",
      'export function ChatScreen() { return null }',
    ],
  }

  withExport({
    'index.js': "const stateDescription = 'reply proof state'",
    'index.js.map': JSON.stringify(bundleMap),
  }, (root) => assert.doesNotThrow(() => inspectExport(root)))
})
