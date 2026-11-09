import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const conversation = readFileSync(new URL('./OnboardingConversation.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('./OnboardingShell.tsx', import.meta.url), 'utf8')
const work = readFileSync(new URL('../../../features/work/components/WorkPage.tsx', import.meta.url), 'utf8')

test('payment controls keep their identity while saving the task and while busy', () => {
  assert.match(conversation, /busy && session\.step !== 'task'/)
  assert.match(conversation, /<div key=\{session\.step\}/)
  assert.doesNotMatch(conversation, /key=\{`\$\{session\.step\}:\$\{session\.revision\}`\}/)
})

test('completion navigates without a delayed tour and retains the last composer until Work arrives', () => {
  assert.doesNotMatch(shell, /OnboardingTour|setTimeout/)
  assert.match(shell, /if \(next\.completed && next\.session\?\.taskId\)/)
  assert.match(shell, /openWork\(next\.session\.taskId\)/)
  assert.match(shell, /setHandoff\(\{ taskId: next\.session\.taskId, session: result\?\.session \?\? next\.session/)
  assert.match(shell, /if \(next\.completed && next\.session\?\.taskId\) \{[\s\S]*?setActive\(false\);[\s\S]*?openWork\(next\.session\.taskId\)/)
  assert.match(shell, /setResult\(next\)/)
  assert.doesNotMatch(shell, /atWork|endsWith\("\/work"\)/)
  assert.match(shell, /onReady: finishHandoff/)
  assert.match(conversation, /action\.action === 'finish' \? 0 : 450/)
  assert.match(shell, /handoff \? "relative z-10 bg-background"/)
  assert.match(work, /useOnboardingWorkReady\(taskId, state === 'error' \|\| state === 'signed_out' \|\| \(loaded && !taskId\)\)/)
})
