import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const serverSecret = 'generated-ui-persistence-test'
const userId = 'generated-ui-user'

describe('generated UI conversation persistence', () => {
  test('persists and round-trips a questionnaire assistant part', async () => {
    process.env.INTERNAL_API_SECRET = serverSecret
    const convex = convexTest(schema, modules)
    const conversationId = await convex.mutation(api.chat.conversations.create, {
      title: 'Questionnaire persistence',
      userId,
      serverSecret,
      lastMode: 'act',
    })
    const userMessageId = await convex.mutation(api.chat.conversations.addMessage, {
      conversationId,
      content: 'Help me choose a focus.',
      contentType: 'text',
      mode: 'act',
      parts: [{ type: 'text', text: 'Help me choose a focus.' }],
      role: 'user',
      serverSecret,
      skipMemoryExtraction: true,
      turnId: 'questionnaire-turn',
      userId,
    })
    const run = await convex.mutation(api.chat.conversations.startAgentRun, {
      conversationId,
      mode: 'chat',
      modelId: 'test-model',
      runner: 'tool_loop',
      serverSecret,
      turnId: 'questionnaire-turn',
      userId,
      userMessageId,
    })
    await convex.mutation(api.chat.conversations.transitionAgentRun, {
      leaseExpiresAt: Date.now() + 60_000,
      runId: run._id,
      serverSecret,
      status: 'running',
      userId,
    })
    const questionnairePart = {
      type: 'data' as const,
      id: 'questionnaire-part',
      dataType: 'overlay.generated_ui' as const,
      data: {
        version: 1 as const,
        kind: 'questionnaire' as const,
        prompt: 'What should we focus on?',
        choices: [
          { id: 'research', label: 'Research' },
          { id: 'planning', label: 'Planning' },
        ],
        multiple: true,
      },
    }

    const completed = await convex.mutation(api.chat.conversations.completeAgentRun, {
      content: questionnairePart.data.prompt,
      parts: [questionnairePart],
      runId: run._id,
      serverSecret,
      tokens: { input: 1, output: 2 },
      userId,
    })

    expect(completed?.status).toBe('completed')
    const messages = await convex.query(api.chat.conversations.getMessages, {
      conversationId,
      serverSecret,
      userId,
    })
    const assistant = messages.find((message) => message.role === 'assistant')
    expect(assistant?.parts).toContainEqual(questionnairePart)
  })
})
