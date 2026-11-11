import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('room and external panels leave resizing to the shell, while preview panels control their own width', async () => {
  const source = await readFile('src/features/chat/components/DirectMessageExperience.tsx', 'utf8')
  assert.match(source, /rightPanelWidth=\{panels\.shellRightPanel \? panels\.shellRightPanelWidth : externalRightPanel \? \(externalRightPanelWidth \?\? 'lg'\) : 380\}/)
  assert.match(source, /onRightPanelResize=\{panels\.shellRightPanel \? panels\.shellRightPanelResize : undefined\}/)
})

test('jump to latest is available with zero unread messages and releases the turn anchor before scrolling', async () => {
  const parts = await readFile('src/features/chat/components/DirectMessageExperience.parts.tsx', 'utf8')
  const hooks = await readFile('src/features/chat/components/DirectMessageExperience.hooks.ts', 'utf8')
  assert.match(parts, /\{hasContentBelow \? \(/)
  assert.match(parts, /onClick=\{onJumpToLatest\}/)
  assert.match(parts, /: 'Jump to latest ↓'/)
  assert.doesNotMatch(parts, /newMessageCount > 0 && !stickToBottom/)
  assert.match(hooks, /releaseTurnAnchor\?\.\(\)[\s\S]*?setStickToBottom\(true\)[\s\S]*?node\.scrollTo\(\{ top: node\.scrollHeight, behavior: 'smooth' \}\)/)
})
