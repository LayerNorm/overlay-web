import assert from 'node:assert/strict'
import test from 'node:test'
import { TERMINAL_KEYS, renderTerminalScreen, terminalInputBytes } from './terminal-screen'

test('named keys become terminal bytes after typed data', () => {
  assert.equal(terminalInputBytes({ data: ':wq', keys: ['Enter'] }), ':wq\r')
  assert.equal(terminalInputBytes({ keys: ['Ctrl-C'] }), '\x03')
  assert.equal(terminalInputBytes({ keys: ['Up', 'Enter'] }), '\x1b[A\r')
  assert.equal(TERMINAL_KEYS.Escape, '\x1b')
})

test('screen mode collapses redraws to what is visible now', async () => {
  const progress = Array.from({ length: 50 }, (_, i) => `\rdownloading ${i * 2}%`).join('') + '\r\ndone\r\n$ '
  const { screen, cursor } = await renderTerminalScreen(progress, 40, 6)
  assert.equal(screen, 'downloading 98%\ndone\n$')
  assert.deepEqual(cursor, { line: 3, column: 3 })
})

test('full-screen programs render the alternate screen, not the history', async () => {
  const vim = 'old shell output\r\n\x1b[?1049h\x1b[2J\x1b[Hfile line 1\r\n~\r\n~\x1b[6;1H-- INSERT --'
  const { screen } = await renderTerminalScreen(vim, 30, 6)
  assert.equal(screen, 'file line 1\n~\n~\n\n\n-- INSERT --')
  assert.doesNotMatch(screen, /old shell output/)
})
