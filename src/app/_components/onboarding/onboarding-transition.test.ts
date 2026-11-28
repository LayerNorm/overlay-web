import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const conversation = readFileSync(new URL('./OnboardingConversation.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('./OnboardingShell.tsx', import.meta.url), 'utf8')
const agents = readFileSync(new URL('../../../features/agents/components/AgentConversationWorkspace.tsx', import.meta.url), 'utf8')

test('payment controls keep their identity while saving the task and while busy', () => {
  assert.match(conversation, /busy && session\.step !== 'task'/)
  assert.match(conversation, /<div key=\{session\.step\}/)
  assert.doesNotMatch(conversation, /key=\{`\$\{session\.step\}:\$\{session\.revision\}`\}/)
})

test('completion opens the Overlay chat on the Agents page and retains the last composer until it arrives', () => {
  assert.doesNotMatch(shell, /OnboardingTour|setTimeout|\/app\/work/)
  assert.match(shell, /agentThreadHref\(buildWorkspaceHref\(workspaceId, "\/app\/agents", "workspace"\), session\.agentId, session\.conversationId, "workspace"\)/)
  assert.match(shell, /if \(next\.completed && next\.session\) \{[\s\S]*?setHandoff\(result\?\.session \?\? next\.session\);[\s\S]*?setActive\(false\);[\s\S]*?openChat\(next\.session\)/)
  assert.match(shell, /setResult\(next\)/)
  assert.doesNotMatch(shell, /atWork|endsWith\("\/work"\)/)
  assert.match(shell, /onReady: finishHandoff/)
  assert.match(conversation, /action\.action === 'finish' \? 0 : 450/)
  assert.match(shell, /handoff \? "relative z-10 bg-background"/)
  assert.match(agents, /useOnboardingHandoffReady\(requestedThreadId, detailState === 'unavailable' \|\| \(detailState === 'ready' && !threadScope\.pending\)\)/)
})
