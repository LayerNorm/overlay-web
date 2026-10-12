import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentProfileBundle } from '@layernorm/overlay-agent-bridge-protocol'
import { planProfileApply } from './agent-profile-apply'

const bundle = (overrides: Partial<AgentProfileBundle> = {}): AgentProfileBundle => ({
  version: 1, harness: 'claude-code', secrets: [], hooks: [], mcpServers: {},
  files: [{ path: 'CLAUDE.md', content: 'Rules' }, { path: 'skills/x/SKILL.md', content: 'Skill' }, { path: 'skills/x/run.sh', content: '#!/bin/sh\necho' }],
  ...overrides,
})

test('files go under the harness folder, and scripts keep their executable bit', () => {
  const { plan, claudeJson } = planProfileApply({ bundle: bundle(), hooksEnabled: false, version: 3, previous: null, existingClaudeJson: null })
  assert.deepEqual(plan.writes.map((w) => [w.path, w.executable]), [
    ['/home/user/.claude/CLAUDE.md', false], ['/home/user/.claude/skills/x/SKILL.md', false], ['/home/user/.claude/skills/x/run.sh', true],
  ])
  assert.equal(claudeJson, null)
  assert.deepEqual(plan.manifest, { version: 3, harness: 'claude-code', files: ['CLAUDE.md', 'skills/x/SKILL.md', 'skills/x/run.sh'], mcpServers: [] })
})

test('a later apply removes what the earlier one wrote and this one does not, and nothing else', () => {
  const previous = { version: 1, harness: 'claude-code' as const, files: ['CLAUDE.md', 'commands/old.md', 'skills/x/SKILL.md'], mcpServers: [] }
  const { plan } = planProfileApply({ bundle: bundle(), hooksEnabled: false, version: 2, previous, existingClaudeJson: null })
  assert.deepEqual(plan.removes, ['/home/user/.claude/commands/old.md'])
  // A profile for the other agent never removes this one's files.
  const other = planProfileApply({ bundle: bundle({ harness: 'codex', files: [{ path: 'AGENTS.md', content: 'x' }] }), hooksEnabled: false, version: 2, previous, existingClaudeJson: null })
  assert.deepEqual(other.plan.removes, [])
})

test('MCP servers merge into ~/.claude.json: the rest of the file is kept, replaced servers are removed', () => {
  const existing = JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' }, projects: { '/x': {} }, mcpServers: { handmade: { command: 'keep' }, old: { command: 'gone' } } })
  const { claudeJson } = planProfileApply({
    bundle: bundle({ mcpServers: { github: { command: 'npx', env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } } } }),
    hooksEnabled: false, version: 2, previous: { version: 1, harness: 'claude-code', files: [], mcpServers: ['old'] }, existingClaudeJson: existing,
  })
  const merged = JSON.parse(claudeJson!)
  assert.deepEqual(Object.keys(merged.mcpServers).sort(), ['github', 'handmade'])
  assert.deepEqual(merged.oauthAccount, { emailAddress: 'a@b.c' })
  assert.deepEqual(merged.projects, { '/x': {} })
})

test('hooks are written only when turned on', () => {
  const withHooksBundle = bundle({
    files: [{ path: 'settings.json', content: JSON.stringify({ model: 'opus' }) }],
    hooks: [{ kind: 'hook', event: 'PostToolUse', command: './capture.sh' }, { kind: 'statusline', event: 'statusLine', command: '~/s.sh' }],
  })
  const off = planProfileApply({ bundle: withHooksBundle, hooksEnabled: false, version: 1, previous: null, existingClaudeJson: null })
  assert.deepEqual(JSON.parse(off.plan.writes[0]!.content), { model: 'opus' })
  const on = planProfileApply({ bundle: withHooksBundle, hooksEnabled: true, version: 1, previous: null, existingClaudeJson: null })
  const settings = JSON.parse(on.plan.writes[0]!.content)
  assert.equal(settings.model, 'opus')
  assert.deepEqual(settings.hooks.PostToolUse, [{ hooks: [{ type: 'command', command: './capture.sh' }] }])
  assert.deepEqual(settings.statusLine, { type: 'command', command: '~/s.sh' })
  // With no settings file imported, enabling hooks still creates one.
  const created = planProfileApply({ bundle: bundle({ files: [], hooks: withHooksBundle.hooks }), hooksEnabled: true, version: 1, previous: null, existingClaudeJson: null })
  assert.equal(created.plan.writes[0]!.path, '/home/user/.claude/settings.json')
})

test('Codex notify is put first in config.toml when enabled', () => {
  const codex = bundle({ harness: 'codex', files: [{ path: 'config.toml', content: 'model = "gpt-5"\n' }], hooks: [{ kind: 'notify', event: 'notify', command: '["bash","-c","echo"]' }] })
  assert.equal(planProfileApply({ bundle: codex, hooksEnabled: true, version: 1, previous: null, existingClaudeJson: null }).plan.writes[0]!.content, 'notify = ["bash","-c","echo"]\nmodel = "gpt-5"\n')
  assert.equal(planProfileApply({ bundle: codex, hooksEnabled: false, version: 1, previous: null, existingClaudeJson: null }).plan.writes[0]!.content, 'model = "gpt-5"\n')
})
