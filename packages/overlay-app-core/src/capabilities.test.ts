import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_OVERLAY_CAPABILITIES,
  deriveOverlayCapabilities,
  resolveOverlayAppShellConfig,
} from './index'

test('deriveOverlayCapabilities fills defaults from partial runtime config', () => {
  assert.deepEqual(deriveOverlayCapabilities({ billing: false, automations: false }), {
    ...DEFAULT_OVERLAY_CAPABILITIES,
    billing: false,
    automations: false,
  })
  assert.deepEqual(deriveOverlayCapabilities({ capabilities: { webhooks: true } }), {
    ...DEFAULT_OVERLAY_CAPABILITIES,
    webhooks: true,
  })
})

test('resolveOverlayAppShellConfig hides capability-gated registries', () => {
  const shell = resolveOverlayAppShellConfig(undefined, {
    capabilities: {
      automations: false,
      projects: false,
      vectorSearch: false,
    },
  })

  assert.equal(shell.capabilities.automations, false)
  assert.equal(shell.capabilities.projects, false)
  assert.equal(shell.navigation.some((item) => item.id === 'automations'), false)
  assert.equal(shell.navigation.some((item) => item.id === 'projects'), false)
  assert.equal(shell.sidebarActions.some((item) => item.actionKey === 'automations.create'), false)
  assert.equal(shell.sidebarActions.some((item) => item.actionKey === 'projects.create'), false)
  assert.equal(shell.tools.some((item) => item.id === 'automation-runner'), false)
  assert.equal(shell.tools.some((item) => item.id === 'knowledge-search'), false)
  assert.equal(shell.settingsSections.some((item) => item.id === 'memories'), false)
  assert.equal(shell.settingsPanels.some((item) => item.id === 'memories'), false)
  assert.equal(shell.settingsSections.some((item) => item.id === 'webhooks'), false)
  assert.equal(shell.settingsPanels.some((item) => item.id === 'webhooks'), false)
  assert.equal(shell.navigation.some((item) => item.id === 'files'), true)
  assert.equal(shell.appFeatureFlags.canUseAutomations, false)
  assert.equal(shell.appFeatureFlags.canUseProjects, false)
  assert.equal(shell.appFeatureFlags.canUseKnowledge, true)
})

test('resolveOverlayAppShellConfig exposes webhook settings when enabled', () => {
  const shell = resolveOverlayAppShellConfig(undefined, {
    capabilities: { webhooks: true },
  })

  assert.equal(shell.settingsSections.some((item) => item.id === 'webhooks'), true)
  assert.equal(shell.settingsPanels.some((item) => item.id === 'webhooks'), true)
})

test('redacted capability bootstrap payload exposes capabilities without secrets', () => {
  const shell = resolveOverlayAppShellConfig(undefined, {
    capabilities: {
      billing: false,
      webhooks: false,
      vectorSearch: false,
      automations: false,
    },
  })
  const payload = {
    capabilities: shell.capabilities,
    featureFlags: shell.appFeatureFlags,
    navigation: shell.navigation.map((item) => item.id),
    settingsSections: shell.settingsSections.map((item) => item.id),
  }

  assert.deepEqual(payload, {
    capabilities: {
      ...DEFAULT_OVERLAY_CAPABILITIES,
      billing: false,
      webhooks: false,
      vectorSearch: false,
      automations: false,
    },
    featureFlags: {
      canUseVoiceTranscription: true,
      canUseKnowledge: true,
      canUseProjects: true,
      canUseAutomations: false,
      canUseExtensions: true,
    },
    navigation: ['chat', 'files', 'extensions', 'projects'],
    settingsSections: ['general', 'account', 'customization', 'models', 'contact'],
  })
  assert.equal(JSON.stringify(payload).includes('secret'), false)
})
