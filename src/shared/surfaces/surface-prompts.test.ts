import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSurfaceSystemPrompt,
  stripSlackMentionMarkup,
  surfaceConversationTitle,
  surfacePlatformLabel,
} from './surface-prompts'

test('surfaceConversationTitle labels the platform and channel', () => {
  assert.equal(
    surfaceConversationTitle({ platform: 'slack', channelName: 'fundraising', channelId: 'C1' }),
    'Slack · #fundraising',
  )
  // Falls back to the raw channel id when Slack gave no name (e.g. DMs).
  assert.equal(
    surfaceConversationTitle({ platform: 'slack', channelId: 'D0ABC' }),
    'Slack · #D0ABC',
  )
})

test('surfacePlatformLabel keeps unknown platforms readable', () => {
  assert.equal(surfacePlatformLabel('slack'), 'Slack')
  assert.equal(surfacePlatformLabel('discord'), 'discord')
})

test('buildSurfaceSystemPrompt carries the agent persona and platform context', () => {
  const prompt = buildSurfaceSystemPrompt({
    platform: 'slack',
    channelName: 'fundraising',
    agentName: 'Scout',
    agentInstructions: 'You track competitors.',
  })
  assert.match(prompt, /You track competitors\./)
  assert.match(prompt, /You are Scout, replying on Slack in #fundraising\./)
  // Surface turns must never inherit scheduled-automation framing.
  assert.doesNotMatch(prompt, /automation/i)
})

test('buildSurfaceSystemPrompt works without agent instructions', () => {
  const prompt = buildSurfaceSystemPrompt({
    platform: 'slack',
    agentName: 'Scout',
  })
  assert.match(prompt, /replying on Slack/)
  assert.equal(prompt.startsWith('You are Scout'), true)
})

test('stripSlackMentionMarkup removes mentions and broadcast tags', () => {
  assert.equal(stripSlackMentionMarkup('<@U12345> what shipped today?'), 'what shipped today?')
  assert.equal(stripSlackMentionMarkup('<!channel> heads up <@U99>'), 'heads up')
  assert.equal(stripSlackMentionMarkup('<!here>'), '')
  assert.equal(stripSlackMentionMarkup('  plain text  '), 'plain text')
})
