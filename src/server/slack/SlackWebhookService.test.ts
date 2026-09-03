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

function scoutAgent() {
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
}

function masterAgent() {
  return { ...scoutAgent(), id: 'agent-master', principalId: 'agent-principal-master', name: 'Overlay', isDefault: true }
}

type FakeCalls = {
  posted: unknown[]
  ephemeral: unknown[]
  messages: unknown[]
  guards: unknown[]
  audits: unknown[]
  scheduled: Array<() => Promise<void>>
  order: string[]
  runTurnArgs: unknown[]
  claimed: Set<string>
}

function fakeDeps(overrides: Partial<SlackBotDeps> = {}): SlackBotDeps & {
  calls: FakeCalls
} {
  const calls: FakeCalls = {
    posted: [],
    ephemeral: [],
    messages: [],
    guards: [],
    audits: [],
    scheduled: [],
    order: [],
    runTurnArgs: [],
    claimed: new Set<string>(),
  }
  return {
    calls,
    scheduleWork: (task: () => Promise<void>) => {
      calls.scheduled.push(task)
    },
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
        calls.order.push('message')
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
      async claimPlatformEvent({ directory, externalTeamId, eventId }: {
        directory: string
        externalTeamId: string
        eventId: string
      }) {
        const key = `${directory}:${externalTeamId}:${eventId}`
        if (calls.claimed.has(key)) return false
        calls.claimed.add(key)
        return true
      },
    },
    workspaceAgents: {
      async get() {
        return scoutAgent()
      },
      async list() {
        return { agents: [masterAgent(), scoutAgent()], canCreate: true }
      },
    },
    audit: {
      async record(args: unknown) {
        calls.audits.push(args)
      },
    },
    runTurn: (async (args: unknown) => {
      calls.order.push('run')
      calls.runTurnArgs.push(args)
      return { content: 'Probe reply', modelId: 'test-model', parts: [], tokens: { input: 1, output: 1 } }
    }) as SlackBotDeps['runTurn'],
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
      calls.order.push('post')
      return { ok: true, channel: 'C123', ts: '1.0' }
    }) as SlackBotDeps['postMessage'],
    postEphemeral: (async (args: unknown) => {
      calls.ephemeral.push(args)
      return { ok: true, channel: 'C123', ts: '1.0' }
    }) as SlackBotDeps['postEphemeral'],
    baseUrl: () => 'https://overlay.test',
    decryptToken: () => 'xoxb-test',
    assertLimits: (async (args: unknown) => {
      calls.guards.push(args)
      calls.order.push('guard')
    }),
    ...overrides,
  } as SlackBotDeps & { calls: FakeCalls }
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
    { signingSecret: SECRET, workspaceId: WORKSPACE, botToken: 'xoxb-test' },
  )
  assert.equal(response.status, 200)
  // `after()` does not run in this harness; drive the scheduled work directly.
  await service.handleMention({
    teamId: 'T123',
    channelId: 'C123',
    threadTs: '1788000000.0001',
    text: '<@U123> scout, summarize this',
    slackUserId: 'U999',
    eventId: 'Ev123',
  }, { signingSecret: SECRET, workspaceId: WORKSPACE, botToken: 'xoxb-test' })
  assert.equal(deps.calls.messages.length, 1)
  assert.equal(deps.calls.guards.length, 1)
  assert.equal(deps.calls.posted.length, 1)
  const reply = deps.calls.posted[0] as {
    channel: string
    threadTs: string
    token: string
    text: string
    blocks: Array<{ type: string; elements?: Array<{ action_id: string; value: string }> }>
  }
  assert.equal(reply.channel, 'C123')
  assert.equal(reply.threadTs, '1788000000.0001')
  assert.equal(reply.token, 'xoxb-test')
  assert.equal(reply.text, 'Probe reply')
  assert.equal(reply.blocks[1]?.elements?.[0]?.action_id, 'overlay_manage')
  assert.equal(reply.blocks[1]?.elements?.[0]?.value, AGENT_ID)
})

test('redelivered events ack as duplicates without rescheduling', async () => {
  const deps = fakeDeps()
  const service = new SlackWebhookService(deps)
  const deliver = () => {
    const body = mentionBody()
    const timestamp = String(Math.floor(Date.now() / 1_000))
    return service.handleRequest(
      new Request('https://overlay.test/api/webhooks/slack', {
        method: 'POST',
        body,
        headers: {
          'x-slack-signature': signSlackRequest(body, timestamp),
          'x-slack-request-timestamp': timestamp,
        },
      }),
      { signingSecret: SECRET },
    )
  }
  const first = await deliver()
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), { received: true, handled: true })
  const second = await deliver()
  assert.equal(second.status, 200)
  assert.deepEqual(await second.json(), { received: true, handled: false, duplicate: true })
  assert.equal(deps.calls.scheduled.length, 1)
})

test('claim failures fail open so receipts never block the bot', async () => {
  const deps = fakeDeps({
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
      async claimPlatformEvent() {
        throw new Error('receipts unavailable')
      },
    } as SlackBotDeps['governance'],
  })
  const body = mentionBody()
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const response = await new SlackWebhookService(deps).handleRequest(
    new Request('https://overlay.test/api/webhooks/slack', {
      method: 'POST',
      body,
      headers: {
        'x-slack-signature': signSlackRequest(body, timestamp),
        'x-slack-request-timestamp': timestamp,
      },
    }),
    { signingSecret: SECRET },
  )
  assert.equal(response.status, 200)
  assert.equal(deps.calls.scheduled.length, 1)
})

test('bot turns run the mapped user through limits before any model work', async () => {
  const deps = fakeDeps()
  await new SlackWebhookService(deps).handleMention({
    teamId: 'T123',
    channelId: 'C123',
    threadTs: '1788000000.0001',
    text: '<@U123> scout, summarize this',
    slackUserId: 'U999',
    eventId: 'EvMeter',
  }, { signingSecret: SECRET, workspaceId: WORKSPACE, botToken: 'xoxb-test' })
  // The usage gate precedes persistence, which precedes the model turn,
  // which precedes the post — the same order first-party clients enforce,
  // so bot invocations bill through the identical entitlement path.
  assert.deepEqual(deps.calls.order, ['guard', 'message', 'run', 'post'])
  assert.deepEqual(deps.calls.guards, [{
    workspaceId: WORKSPACE,
    principalId: PRINCIPAL,
    conversationId: 'dm-1',
  }])
  const runArgs = deps.calls.runTurnArgs[0] as { actorUserId: string; workspaceId: string }
  assert.equal(runArgs.actorUserId, USER)
  assert.equal(runArgs.workspaceId, WORKSPACE)
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
  }, { signingSecret: SECRET, workspaceId: WORKSPACE, botToken: 'xoxb-test' })
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
  }, { signingSecret: SECRET, workspaceId: WORKSPACE, botToken: 'xoxb-test' })
  assert.deepEqual(deps.calls.posted, [])
  assert.deepEqual(deps.calls.messages, [])
})

test('mention with no name match falls back to the default agent', async () => {
  const deps = fakeDeps()
  await new SlackWebhookService(deps).handleMention({
    teamId: 'T123',
    channelId: 'C123',
    threadTs: '1.0',
    text: '<@U123> hello there',
    slackUserId: 'U999',
  }, { signingSecret: SECRET, workspaceId: WORKSPACE, botToken: 'xoxb-test' })
  // Default master answers; the fake invocation targets Scout, so no run —
  // this asserts the fallback resolves (master) rather than erroring.
  assert.equal(deps.calls.messages.length, 1)
  assert.deepEqual(deps.calls.posted, [])
})

test('slash agents answers ephemerally with the directory', async () => {
  const deps = fakeDeps()
  await new SlackWebhookService(deps).handleSlash({
    teamId: 'T123',
    channelId: 'C123',
    text: 'agents',
    slackUserId: 'U999',
    command: '/overlay',
    triggerId: '123.456',
  }, { signingSecret: SECRET })
  assert.equal(deps.calls.ephemeral.length, 1)
  const reply = deps.calls.ephemeral[0] as { user: string; text: string; blocks: unknown[] }
  assert.equal(reply.user, 'U999')
  assert.match(reply.text, /2 workspace agents/)
  assert.deepEqual(deps.calls.posted, [])
  assert.equal(deps.calls.messages.length, 0)
})

test('slash ask runs the named agent and posts to the channel', async () => {
  const deps = fakeDeps()
  await new SlackWebhookService(deps).handleSlash({
    teamId: 'T123',
    channelId: 'C123',
    text: 'ask scout summarize this',
    slackUserId: 'U999',
    command: '/overlay',
    triggerId: '123.456',
  }, { signingSecret: SECRET })
  assert.equal(deps.calls.messages.length, 1)
  assert.equal(deps.calls.posted.length, 1)
  const reply = deps.calls.posted[0] as { channel: string; threadTs?: string; blocks: unknown[] }
  assert.equal(reply.channel, 'C123')
  assert.equal(reply.threadTs, undefined)
})

test('slash ask for an invisible agent stays silent', async () => {
  const deps = fakeDeps({
    workspaceAgents: {
      async get() {
        throw Object.assign(new Error('Agent not found'), { code: 'not_found' })
      },
      // Directory holds only the master: "scout" is invisible to this actor.
      async list() {
        return { agents: [masterAgent()], canCreate: true }
      },
    } as SlackBotDeps['workspaceAgents'],
  })
  await new SlackWebhookService(deps).handleSlash({
    teamId: 'T123',
    channelId: 'C123',
    text: 'ask scout summarize this',
    slackUserId: 'U999',
    command: '/overlay',
    triggerId: '123.456',
  }, { signingSecret: SECRET })
  // "scout" matches nothing visible, so the master answers instead — through
  // the same visibility-filtered directory, never the hidden agent. The fake
  // invocation targets Scout, so no run is posted here.
  assert.equal(deps.calls.messages.length, 1)
  assert.deepEqual(deps.calls.posted, [])
})

test('slash help answers ephemerally with usage', async () => {
  const deps = fakeDeps()
  await new SlackWebhookService(deps).handleSlash({
    teamId: 'T123',
    channelId: 'C123',
    text: 'dance',
    slackUserId: 'U999',
    command: '/overlay',
  }, { signingSecret: SECRET })
  assert.equal(deps.calls.ephemeral.length, 1)
  assert.match((deps.calls.ephemeral[0] as { text: string }).text, /Overlay bot/)
})

test('manage action audits the click and answers with the deep link', async () => {
  const deps = fakeDeps()
  await new SlackWebhookService(deps).handleManageAction({
    teamId: 'T123',
    channelId: 'C123',
    slackUserId: 'U999',
    agentId: AGENT_ID,
  }, { signingSecret: SECRET })
  assert.equal(deps.calls.audits.length, 1)
  const audit = deps.calls.audits[0] as {
    action: string
    actorUserId: string
    resourceType: string
    resourceId: string
    metadata: Record<string, unknown>
  }
  assert.equal(audit.action, 'slack.manage_link_click')
  assert.equal(audit.actorUserId, USER)
  assert.equal(audit.resourceType, 'agent')
  assert.equal(audit.resourceId, AGENT_ID)
  assert.equal(audit.metadata.workspaceId, WORKSPACE)
  assert.equal(deps.calls.ephemeral.length, 1)
  const reply = deps.calls.ephemeral[0] as { user: string; text: string }
  assert.equal(reply.user, 'U999')
  assert.match(reply.text, /https:\/\/overlay\.test\/app\/w\/workspace-1\/agents\/agent-1/)
})

test('manage action on an invisible agent stays silent without auditing', async () => {
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
  await new SlackWebhookService(deps).handleManageAction({
    teamId: 'T123',
    channelId: 'C123',
    slackUserId: 'U999',
    agentId: 'agent-hidden',
  }, { signingSecret: SECRET })
  assert.deepEqual(deps.calls.audits, [])
  assert.deepEqual(deps.calls.ephemeral, [])
})

test('slash and action payloads route through the signed webhook', async () => {
  const deps = fakeDeps()
  const service = new SlackWebhookService(deps)
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const slashBody = 'command=%2Foverlay&text=agents&user_id=U999&channel_id=C123&team_id=T123&trigger_id=123.456'
  const slashResponse = await service.handleRequest(
    new Request('https://overlay.test/api/webhooks/slack', {
      method: 'POST',
      body: slashBody,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-signature': signSlackRequest(slashBody, timestamp),
        'x-slack-request-timestamp': timestamp,
      },
    }),
    { signingSecret: SECRET },
  )
  assert.equal(slashResponse.status, 200)
  const actionBody = `payload=${encodeURIComponent(JSON.stringify({
    type: 'block_actions',
    team: { id: 'T123' },
    user: { id: 'U999' },
    channel: { id: 'C123' },
    actions: [{ action_id: 'overlay_manage', value: AGENT_ID, type: 'button' }],
  }))}`
  const actionResponse = await service.handleRequest(
    new Request('https://overlay.test/api/webhooks/slack', {
      method: 'POST',
      body: actionBody,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-signature': signSlackRequest(actionBody, timestamp),
        'x-slack-request-timestamp': timestamp,
      },
    }),
    { signingSecret: SECRET },
  )
  assert.equal(actionResponse.status, 200)
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
