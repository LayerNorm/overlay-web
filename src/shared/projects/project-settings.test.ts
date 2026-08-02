import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyProjectToolPolicy,
  copyableProjectSettings,
  isProjectResourceEnabled,
  projectAutomationsEnabled,
  readProjectSettings,
} from './project-settings'

test('absent or malformed settings read as inherit-everything', () => {
  for (const value of [undefined, null, 'nope', 42, [], { toolPolicy: 'bad' }]) {
    assert.deepEqual(readProjectSettings(value), {})
  }
})

test('unknown keys and bad modes are dropped rather than trusted', () => {
  const settings = readProjectSettings({
    preferredModelId: '  anthropic/claude  ',
    toolPolicy: { mode: 'wide-open', toolIds: ['x'] },
    somethingElse: true,
  })
  assert.equal(settings.preferredModelId, 'anthropic/claude')
  assert.equal(settings.toolPolicy, undefined, 'an unrecognized mode must not grant anything')
  assert.equal((settings as Record<string, unknown>).somethingElse, undefined)
})

test('inherit mode leaves the account-allowed set untouched', () => {
  const allowed = ['search_knowledge', 'generate_image', 'list_notes']
  assert.deepEqual(applyProjectToolPolicy(allowed, {}), allowed)
  assert.deepEqual(applyProjectToolPolicy(allowed, { toolPolicy: { mode: 'inherit' } }), allowed)
})

test('an allowlist narrows to the listed tools', () => {
  const allowed = ['search_knowledge', 'generate_image', 'list_notes']
  assert.deepEqual(
    applyProjectToolPolicy(allowed, {
      toolPolicy: { mode: 'allowlist', toolIds: ['search_knowledge', 'list_notes'] },
    }),
    ['search_knowledge', 'list_notes'],
  )
})

test('an empty allowlist means no optional tools, not all tools', () => {
  assert.deepEqual(
    applyProjectToolPolicy(['search_knowledge', 'generate_image'], {
      toolPolicy: { mode: 'allowlist' },
    }),
    [],
  )
})

test('a denylist removes only the listed tools', () => {
  assert.deepEqual(
    applyProjectToolPolicy(['search_knowledge', 'generate_image', 'list_notes'], {
      toolPolicy: { mode: 'denylist', toolIds: ['generate_image'] },
    }),
    ['search_knowledge', 'list_notes'],
  )
})

test('a project can never widen beyond what the account already allows', () => {
  // 'run_daytona_sandbox' was withheld upstream; an allowlist naming it must not
  // reintroduce it.
  const accountAllowed = ['search_knowledge']
  assert.deepEqual(
    applyProjectToolPolicy(accountAllowed, {
      toolPolicy: { mode: 'allowlist', toolIds: ['search_knowledge', 'run_daytona_sandbox'] },
    }),
    ['search_knowledge'],
  )
})

test('resource enablement distinguishes inherit from explicitly none', () => {
  assert.equal(isProjectResourceEnabled(undefined, 'skill-1'), true, 'undefined inherits all')
  assert.equal(isProjectResourceEnabled([], 'skill-1'), false, 'empty list allows none')
  assert.equal(isProjectResourceEnabled(['skill-1'], 'skill-1'), true)
  assert.equal(isProjectResourceEnabled(['skill-2'], 'skill-1'), false)
})

test('an explicitly empty list survives parsing', () => {
  const settings = readProjectSettings({ enabledSkillIds: [] })
  assert.deepEqual(settings.enabledSkillIds, [])
  assert.equal(isProjectResourceEnabled(settings.enabledSkillIds, 'anything'), false)
})

test('automations default on and can be switched off', () => {
  assert.equal(projectAutomationsEnabled(undefined), true)
  assert.equal(projectAutomationsEnabled({}), true)
  assert.equal(projectAutomationsEnabled({ automationsEnabled: false }), false)
})

test('duplicating carries configuration but not template status', () => {
  const copied = copyableProjectSettings({
    preferredModelId: 'anthropic/claude',
    toolPolicy: { mode: 'denylist', toolIds: ['generate_image'] },
    enabledSkillIds: ['skill-1'],
    isTemplate: true,
  })
  assert.equal(copied.preferredModelId, 'anthropic/claude')
  assert.deepEqual(copied.toolPolicy, { mode: 'denylist', toolIds: ['generate_image'] })
  assert.deepEqual(copied.enabledSkillIds, ['skill-1'])
  assert.equal(copied.isTemplate, undefined, 'an instance of a template is not itself a template')
})

test('list entries are trimmed, deduped and bounded', () => {
  const settings = readProjectSettings({
    enabledSkillIds: [' a ', 'a', '', '   ', 'b', ...Array.from({ length: 500 }, (_v, i) => `s${i}`)],
  })
  assert.equal(settings.enabledSkillIds?.[0], 'a')
  assert.equal(settings.enabledSkillIds?.[1], 'b')
  assert.ok((settings.enabledSkillIds?.length ?? 0) <= 200)
})
