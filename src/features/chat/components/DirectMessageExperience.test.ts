import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('room and external panels leave resizing to the shell, while preview panels control their own width', async () => {
  const source = await readFile('src/features/chat/components/DirectMessageExperience.tsx', 'utf8')
  assert.match(source, /rightPanelWidth=\{panels\.shellRightPanel \? panels\.shellRightPanelWidth : externalRightPanel \? 'lg' : 380\}/)
  assert.match(source, /onRightPanelResize=\{panels\.shellRightPanel \? panels\.shellRightPanelResize : undefined\}/)
})
