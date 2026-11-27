/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const exportsObject = {}
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(path.join(root, 'lib/incomingLinks.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports: exportsObject, URL, Set },
)
const { incomingRoute } = exportsObject
test('incoming workspace activation handles current, missing, valid and denied destinations', async () => {
  const calls = []
  const activate = exportsObject.activateLinkWorkspace
  const change = async (id) => {
    calls.push(id)
  }
  assert.equal(await activate(undefined, 'a', change), false)
  assert.equal(await activate(['b'], 'a', change), false)
  assert.equal(await activate('a', 'a', change), false)
  assert.equal(await activate('b', 'a', change), true)
  assert.deepEqual(calls, ['b'])
  await assert.rejects(
    activate('c', 'a', async () => {
      throw new Error('Denied')
    }),
    /Denied/,
  )
})
test('EAS workspace preparation uses the monorepo root and installs it only once', () => {
  const { prepareWorkspace, repositoryRoot } = require('./prepare-eas-workspace.cjs')
  assert.equal(repositoryRoot(root), path.resolve(root, '../..'))
  const calls = []
  const installed = prepareWorkspace(root, (...args) => calls.push(args))
  if (installed) assert.deepEqual(calls[0].slice(0, 2), ['npm', ['ci', '--no-audit', '--no-fund']])
  else assert.deepEqual(calls, [])
  assert.throws(() => prepareWorkspace(path.join(root, 'scripts')), /inside the Overlay monorepo/)
})
test('universal and custom links use existing native destinations', () => {
  for (const route of [
    '/work/task',
    '/agent/agent',
    '/dm/thread',
    '/chat/chat',
    '/channel/room',
    '/thread/root',
    '/files/file/file',
    '/note/note',
    '/settings',
    '/automations',
  ]) {
    assert.equal(
      incomingRoute('https://www.getoverlay.io' + route + '?workspaceId=ws'),
      route + '?workspaceId=ws',
    )
    assert.equal(incomingRoute('https://getoverlay.io' + route), route)
    assert.equal(incomingRoute('https://overlay.works' + route), route)
  }
  assert.equal(incomingRoute('https://getoverlay.io/automations/id'), '/automations?id=id')
  assert.equal(incomingRoute('https://getoverlay.io/settings/account'), '/settings?section=account')
  assert.equal(incomingRoute('overlay://dm/id'), '/dm/id')
  assert.equal(incomingRoute('overlay:///dm/id'), '/dm/id')
  assert.equal(incomingRoute('https://getoverlay.io/app/agents/id'), '/agent/id')
  assert.equal(incomingRoute('https://getoverlay.io/app/work/id'), '/work/id')
  assert.equal(incomingRoute('overlay://auth/transfer?token=test'), '/auth/transfer?token=test')
  assert.equal(incomingRoute('/app/invitations/id'), '/invitations/id')
  assert.equal(incomingRoute('overlay://workspace'), '/workspace')
  assert.equal(incomingRoute('https://getoverlay.io/app/settings/workspace?workspaceId=ws'), '/workspace?workspaceId=ws')
  assert.equal(incomingRoute('overlay://account'), '/account')
})
test('extension links keep the selected workspace when opening Tools', () => {
  assert.equal(incomingRoute('overlay://extensions'), '/tools')
  assert.equal(incomingRoute('https://overlay.works/app/integrations?workspaceId=ws'), '/tools?workspaceId=ws')
  assert.equal(incomingRoute('https://untrusted.example/extensions'), '/')
})
test('integration requests keep workspace and connection scope for reads and writes', async () => {
  const calls = []
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path.join(root, 'services/integrationsService.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.equal(name, './appApi')
        return { appJson: async (endpoint, options) => { calls.push({ endpoint, ...options }) } }
      },
    },
  )
  const options = { workspaceId: 'ws', scope: 'workspace' }
  await exports.listIntegrationItems(options)
  await exports.searchIntegrations('calendar', options)
  await exports.connectIntegration('calendar', options)
  await exports.disconnectIntegration('calendar', options)
  assert.deepEqual(calls.map(({ endpoint, workspaceId, query, json }) => [
    endpoint, workspaceId, query?.view ?? json?.scope, query?.action ?? json?.action,
  ]), [
    ['/api/v1/integrations', 'ws', 'workspace', undefined],
    ['/api/v1/integrations', 'ws', 'workspace', 'search'],
    ['/api/v1/integrations', 'ws', 'workspace', 'connect'],
    ['/api/v1/integrations', 'ws', 'workspace', 'disconnect'],
  ])
})
test('removed shared Markdown fixture screen has no incoming route', () => {
  for (const value of [
    'overlay://dev/other',
    'overlay://dev/shared-markdown',
    'overlay://dev/shared-markdown/extra',
    'overlay://dev/shared-markdown?workspaceId=test',
    'overlay:///dev/shared-markdown',
    'https://www.getoverlay.io/dev/shared-markdown',
    'javascript:alert(1)',
  ]) {
    assert.equal(incomingRoute(value), '/')
  }
})
test('invalid, empty, unknown or untrusted incoming links return home', () => {
  for (const value of [
    '',
    'https://evil.example/work/id',
    'http://getoverlay.io/work/id',
    '//evil.example/work/id',
    'https://getoverlay.io/settings/buy',
    'https://getoverlay.io/unknown',
    'https://getoverlay.io/dm/a%2Fb',
  ])
    assert.equal(incomingRoute(value), '/')
})
test('EAS environments are explicit; builds fail closed without a Convex URL', () => {
  const eas = require('../eas.json')
  for (const profile of ['development', 'preview', 'production'])
    assert.equal(eas.build[profile].environment, profile)
  assert.equal(eas.build.production.autoIncrement, true)
  const configure = require('../app.config.js')
  const original = {
    build: process.env.EAS_BUILD,
    url: process.env.EXPO_PUBLIC_CONVEX_URL,
  }
  try {
    process.env.EAS_BUILD = 'true'
    delete process.env.EXPO_PUBLIC_CONVEX_URL
    assert.throws(() => configure({ config: {} }), /EXPO_PUBLIC_CONVEX_URL/)
    process.env.EXPO_PUBLIC_CONVEX_URL = 'https://test.convex.cloud'
    assert.deepEqual(configure({ config: { name: 'Overlay' } }), {
      name: 'Overlay',
    })
  } finally {
    for (const [key, value] of [
      ['EAS_BUILD', original.build],
      ['EXPO_PUBLIC_CONVEX_URL', original.url],
    ]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
test('iOS uses the canonical domain and Android keeps its configured intent filters', () => {
  const config = require('../app.json').expo
  assert.deepEqual(config.ios.associatedDomains, ['applinks:overlay.works'])
  const filter = config.android.intentFilters[0]
  assert.equal(filter.autoVerify, true)
  assert.ok(fs.readFileSync(path.join(root, 'ios/Overlay/Overlay.entitlements'), 'utf8').includes('applinks:overlay.works'))
  for (const host of ['www.getoverlay.io'])
    for (const prefix of [
      '/work',
      '/agent/',
      '/dm/',
      '/chat',
      '/channel/',
      '/thread/',
      '/files',
      '/note/',
      '/automations',
      '/settings',
    ])
      assert.ok(
        filter.data.some(
          (entry) => entry.host === host && (entry.path === prefix || entry.pathPrefix === prefix),
        ),
      )
  assert.equal(config.android.package, 'com.layernorm.overlay_mobile')
  assert.ok(config.ios.infoPlist.NSMicrophoneUsageDescription)
  assert.equal(config.ios.privacyManifests.NSPrivacyTracking, false)
})
