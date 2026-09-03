import 'server-only'

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { SlackInstallService, installationProvider } from './SlackInstallService'
import { SlackWebhookService, type SlackBotDeps } from './SlackWebhookService'

const SECRET = 'test-slack-signing-secret'
const WORKSPACE = 'workspace-1'
const USER = 'user-1'
const PRINCIPAL = 'principal-1'
const AGENT_ID = 'agent-1'
const AGENT_PRINCIPAL = 'agent-principal-1'

function signSlackRequest(body: string, timestamp: string): string {
  return `v0=${createHmac('sha256', SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}`
}

function fakeDeps(overrides: Partial<SlackBotDeps> = {}): SlackBotDeps & {
  calls: { posted: unknown[]; messages: unknown[]; guards: unknown[] }
} {
  const calls: { posted: unknown[]; messages: unknown[]; guards: unknown[] } = {
    posted: [],
    messages: [],
    guards: [],
  }
  return {
    calls,
    scheduleWork: () => undefined,
    access: {
      async openAgentDirectMessage() {
        return {
          conversationId: 'dm-1',
          workspaceId: WORKSPACE,
          title: 'Scout',
          participants: [],
          created: true,
        }
      },
    },
    collaboration: {
      async addMessage(args: unknown) {
        calls.messages.push(args)
        return 'message-1'
      },
    },
    governance: {
      async resolvePlatformActor() {
        return { principalId: PRINCIPAL, userId: USER }
      },
      async getPlatformInstallationByTeam() {
        return {
          id: 'T123',
          workspaceId: WORKSPACE,
          directory: 'slack',
          externalTeamId: 'T123',
          isEnterpriseInstall: false,
          botTokenCipher: 'cipher',
          installedByPrincipalId: PRINCIPAL,
          createdAt: 1,
          updatedAt: 1,
        }
      },
    },
    workspaceAgents: {
      async get() {
        return {
          id: AGENT_ID,
          workspaceId: WORKSPACE,
          principalId: AGENT_PRINCIPAL,
          name: 'Scout',
          instructions: 'Help.',
          harness: 'overlay',
          modelId: 'test-model',
          allowedToolIds: [],
          invocationPolicy: 'mention',
          visibility: 'workspace',
          createdByPrincipalId: PRINCIPAL,
          createdAt: 1,
          updatedAt: 1,
          teamIds: [],
          roomCount: 0,
        }
      },
      async list() {
        return { agents: [], canCreate: false }
      },
    },
    runTurn: (async () => ({ content: 'Probe reply', modelId: 'test-model', parts: [], tokens: { input: 1, output: 1 } })) as SlackBotDeps['runTurn'],
    resolveInvocations: (async () => [{
      agentId: AGENT_ID,
      agentName: 'Scout',
      agentPrincipalId: AGENT_PRINCIPAL,
      invocationNonce: 'agent:message-1:agent-1',
      modelId: 'test-model',
      turnId: 'agent_message-1_agent-1',
    }]) as SlackBotDeps['resolveInvocations'],
    postMessage: (async (args: unknown) => {
      calls.posted.push(args)
      return { ok: true, channel: 'C123', ts: '1.0' }
    }) as SlackBotDeps['postMessage'],
    decryptToken: () => 'xoxb-test',
    assertLimits: (async (args: unknown) => {
      calls.guards.push(args)
    }),
    ...overrides,
  } as SlackBotDeps & { calls: { posted: unknown[]; messages: unknown[]; guards: unknown[] } }
}

function mentionBody() {
  return JSON.stringify({
    token: 'legacy',
    team_id: 'T123',
    api_app_id: 'A123',
    event: {
      type: 'app_mention',
      user: 'U999',
      text: '<@U123> summarize this',
      ts: '1788000000.0001',
      channel: 'C123',
      event_ts: '1788000000.0001',
    },
    type: 'event_callback',
    event_id: 'Ev123',
    event_time: 1788000000,
  })
}

test('unconfigured webhook reports 503 without touching Slack verification', async () => {
  const service = new SlackWebhookService(fakeDeps())
  const response = await service.handleRequest(
    new Request('https://overlay.test/api/webhooks/slack', { method: 'POST', body: '{}' }),
    {},
  )
  assert.equal(response.status, 503)
})

test('bad Slack signatures are rejected', async () => {
  const service = new SlackWebhookService(fakeDeps())
  const response = await service.handleRequest(
    new Request('https://overlay.test/api/webhooks/slack', { method: 'POST', body: mentionBody() }),
    { signingSecret: SECRET },
  )
  assert.equal(response.status, 401)
})

test('url_verification answers the challenge', async () => {
  const service = new SlackWebhookService(fakeDeps())
  const body = JSON.stringify({ type: 'url_verification', challenge: 'challenge-abc' })
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const response = await service.handleRequest(
    new Request('https://overlay.test/api/webhooks/slack', {
      method: 'POST',
      body,
      headers: { 'x-slack-signature': signSlackRequest(body, timestamp), 'x-slack-request-timestamp': timestamp },
    }),
    { signingSecret: SECRET },
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { challenge: 'challenge-abc' })
})

test('mention runs the agent turn and posts the reply to the thread', async () => {
  const deps = fakeDeps()
  const service = new SlackWebhookService(deps)
  const body = mentionBody()
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const response = await service.handleRequest(
    new Request('https://overlay.test/api/webhooks/slack', {
      method: 'POST',
      body,
      headers: { 'x-slack-signature': signSlackRequest(body, timestamp), 'x-slack-request-timestamp': timestamp },
    }),
    { signingSecret: SECRET, workspaceId: WORKSPACE, agentId: AGENT_ID, botToken: 'xoxb-test' },
  )
  assert.equal(response.status, 200)
  // `after()` does not run in this harness; drive the scheduled work directly.
  await service.handleMention({
    teamId: 'T123',
    channelId: 'C123',
    threadTs: '1788000000.0001',
    text: '<@U123> summarize this',
    slackUserId: 'U999',
    eventId: 'Ev123',
  }, { signingSecret: SECRET, workspaceId: WORKSPACE, agentId: AGENT_ID, botToken: 'xoxb-test' })
  assert.equal(deps.calls.messages.length, 1)
  assert.equal(deps.calls.guards.length, 1)
  assert.deepEqual(deps.calls.posted, [{
    channel: 'C123',
    threadTs: '1788000000.0001',
    token: 'xoxb-test',
    markdownText: 'Probe reply',
  }])
})

test('uninstalled teams and unmapped users stay silent', async () => {
  const noInstall = fakeDeps({
    governance: {
      async resolvePlatformActor() {
        return { principalId: PRINCIPAL, userId: USER }
      },
      async getPlatformInstallationByTeam() {
        return null
      },
    } as SlackBotDeps['governance'],
  })
  const service = new SlackWebhookService(noInstall)
  await service.handleMention({
    teamId: 'T999',
    channelId: 'C123',
    threadTs: '1.0',
    text: 'hello',
    slackUserId: 'U999',
  }, { signingSecret: SECRET })
  assert.deepEqual(noInstall.calls.posted, [])

  const unmapped = fakeDeps({
    governance: {
      async resolvePlatformActor() {
        throw Object.assign(new Error('Platform identity is not linked'), { code: 'not_found' })
      },
      async getPlatformInstallationByTeam() {
        return {
          id: 'T123',
          workspaceId: WORKSPACE,
          directory: 'slack',
          externalTeamId: 'T123',
          isEnterpriseInstall: false,
          botTokenCipher: 'cipher',
          installedByPrincipalId: PRINCIPAL,
          createdAt: 1,
          updatedAt: 1,
        }
      },
    } as SlackBotDeps['governance'],
  })
  await new SlackWebhookService(unmapped).handleMention({
    teamId: 'T123',
    channelId: 'C123',
    threadTs: '1.0',
    text: 'hello',
    slackUserId: 'Ughost',
  }, { signingSecret: SECRET, workspaceId: WORKSPACE, agentId: AGENT_ID, botToken: 'xoxb-test' })
  assert.deepEqual(unmapped.calls.posted, [])
  assert.deepEqual(unmapped.calls.messages, [])
})

test('invisible agents resolve to nothing and post nothing', async () => {
  const deps = fakeDeps({
    workspaceAgents: {
      async get() {
        throw Object.assign(new Error('Agent not found'), { code: 'not_found' })
      },
      async list() {
        return { agents: [], canCreate: false }
      },
    } as SlackBotDeps['workspaceAgents'],
  })
  await new SlackWebhookService(deps).handleMention({
    teamId: 'T123',
    channelId: 'C123',
    threadTs: '1.0',
    text: 'hello',
    slackUserId: 'U999',
  }, { signingSecret: SECRET, workspaceId: WORKSPACE, agentId: AGENT_ID, botToken: 'xoxb-test' })
  assert.deepEqual(deps.calls.posted, [])
  assert.deepEqual(deps.calls.messages, [])
})

test('install completion stores the encrypted token against the claimed workspace', async () => {
  const linked: unknown[] = []
  const service = new SlackInstallService({
    governance: {
      async linkPlatformInstallation(args: unknown) {
        linked.push(args)
        return args
      },
    } as never,
    exchangeCode: async () => ({
      botToken: 'xoxb-new',
      teamId: 'T456',
      teamName: 'Acme',
      enterpriseId: undefined,
      isEnterpriseInstall: false,
      botUserId: 'Ubot',
    }),
    encryptToken: (plaintext: string) => `enc:${plaintext}`,
  })
  const result = await service.completeInstall({
    code: 'auth-code',
    claim: { workspaceId: WORKSPACE, principalId: PRINCIPAL, directory: 'slack' },
    redirectUri: 'https://overlay.test/api/webhooks/slack/oauth',
    actorUserId: USER,
  })
  assert.deepEqual(result, { workspaceId: WORKSPACE, teamId: 'T456' })
  assert.deepEqual(linked, [{
    actorUserId: USER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalTeamId: 'T456',
    enterpriseId: undefined,
    isEnterpriseInstall: false,
    teamName: 'Acme',
    botUserId: 'Ubot',
    botTokenCipher: 'enc:xoxb-new',
  }])
})

test('installation provider decrypts our stored installs for the adapter', async () => {
  const provider = installationProvider({
    getRecord: async (installationId: string) => (installationId === 'T123' ? {
      id: 'T123',
      workspaceId: WORKSPACE,
      directory: 'slack',
      externalTeamId: 'T123',
      isEnterpriseInstall: false,
      botTokenCipher: 'cipher',
      installedByPrincipalId: PRINCIPAL,
      createdAt: 1,
      updatedAt: 1,
    } : null),
    decryptToken: (cipher: string) => `plain:${cipher}`,
  })
  assert.deepEqual(
    (await provider.getInstallation('T123', false))?.botToken,
    'plain:cipher',
  )
  assert.equal(await provider.getInstallation('T999', false), null)
})
