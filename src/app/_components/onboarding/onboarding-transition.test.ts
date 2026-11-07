import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const conversation = readFileSync(new URL('./OnboardingConversation.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('./OnboardingShell.tsx', import.meta.url), 'utf8')

test('payment controls keep their identity while saving the task and while busy', () => {
  assert.match(conversation, /busy && session\.step !== 'task'/)
  assert.match(conversation, /<div key=\{session\.step\}/)
  assert.doesNotMatch(conversation, /key=\{`\$\{session\.step\}:\$\{session\.revision\}`\}/)
})

test('completion navigates without a delayed tour and retains the last composer until Work arrives', () => {
  assert.doesNotMatch(shell, /OnboardingTour|setTimeout/)
  assert.match(shell, /if \(next\.completed && next\.session\?\.taskId\)/)
  assert.match(shell, /openWork\(next\.session\.taskId\)/)
  assert.match(shell, /session: result\?\.session \?\? next\.session/)
  assert.match(shell, /!showWork \|\| !atWork/)
  assert.match(conversation, /action\.action === 'finish' \? 0 : 450/)
})
