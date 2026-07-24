import { describe, expect, it } from 'vitest'
import { createDesktopChatTranscriptAdapter } from './desktopChatTranscriptAdapter'
import type { Message } from './types'

const timestamp = 1_721_177_600_000

function user(overrides: Partial<Message> = {}): Message {
  return {
    id: 'user-1',
    turnId: 'turn-1',
    role: 'user',
    content: 'Compare the launch plans.',
    timestamp,
    ...overrides
  }
}

function assistant(overrides: Partial<Message> = {}): Message {
  return {
    id: 'assistant-1',
    turnId: 'turn-1',
    role: 'assistant',
    content: '',
    timestamp: timestamp + 1,
    ...overrides
  }
}

describe('desktopChatTranscriptAdapter', () => {
  it('maps multi-model text, sources, files, generated UI, screenshots, and selection', () => {
    const userMessage = user({
      screenshots: [
        {
          dataUrl: 'data:image/png;base64,AA==',
          displayId: 'display-1',
          name: 'brief.png',
          loadStatus: 'loaded'
        }
      ],
      mentions: [
        { id: 'note-1', type: 'note', title: 'Launch notes' },
        { id: 'document-1', type: 'document', title: 'launch-plan.pdf' }
      ]
    })
    const assistantMessage = assistant({
      selectedModelId: 'beta',
      responses: [
        {
          modelId: 'alpha',
          modelName: 'Alpha',
          provider: 'test',
          content: 'Alpha answer',
          isLoading: false
        },
        {
          modelId: 'beta',
          modelName: 'Beta',
          provider: 'test',
          content: 'Beta answer',
          isLoading: false,
          renderParts: [
            { type: 'reasoning', id: 'reasoning-1', text: 'Compare evidence', state: 'done' },
            {
              type: 'source',
              id: 'source-1',
              sourceKind: 'url',
              sourceId: 'url-1',
              url: 'https://example.test'
            },
            {
              type: 'file',
              id: 'file-1',
              url: 'data:application/pdf;base64,AA==',
              mediaType: 'application/pdf'
            },
            {
              type: 'data',
              id: 'draft-1',
              dataType: 'overlay.generated_ui',
              data: { version: 1, kind: 'draft.text', body: 'Ship beta.' }
            },
            { type: 'text', id: 'text-1', text: 'Beta answer' }
          ]
        }
      ]
    })
    const adapt = createDesktopChatTranscriptAdapter()
    const input = { messages: [userMessage, assistantMessage] }

    const first = adapt(input)
    const second = adapt(input)
    const exchange = first.exchanges[0]!
    expect(exchange.selectedModelId).toBe('beta')
    expect(exchange.selectedResponseIndex).toBe(1)
    expect(exchange.status).toBe('completed')
    expect(exchange.user.images).toEqual([
      {
        url: 'data:image/png;base64,AA==',
        name: 'brief.png',
        mediaType: 'image/png',
        status: 'loaded'
      }
    ])
    expect(exchange.user.documentNames).toEqual(['launch-plan.pdf'])
    expect(exchange.user.indexedAttachments).toEqual([
      { name: 'launch-plan.pdf', fileIds: ['document-1'] }
    ])
    expect(exchange.user.mentions).toEqual([
      { id: 'note-1', type: 'note', name: 'Launch notes' },
      { id: 'document-1', type: 'document', name: 'launch-plan.pdf' }
    ])
    expect(exchange.responses[1]!.blocks.map((block) => block.kind)).toEqual([
      'reasoning',
      'source',
      'file',
      'generated-ui',
      'text'
    ])
    expect(exchange.responses[1]!.sources[0]?.url).toBe('https://example.test')
    expect(second.exchanges[0]).toBe(exchange)
  })

  it('groups legacy alternating messages and preserves assistant ordering', () => {
    const view = createDesktopChatTranscriptAdapter()({
      messages: [
        user({ id: 'legacy-user', turnId: undefined }),
        assistant({
          id: 'legacy-alpha',
          turnId: undefined,
          content: 'Alpha',
          selectedModelId: 'alpha'
        }),
        assistant({
          id: 'legacy-beta',
          turnId: undefined,
          content: 'Beta',
          selectedModelId: 'beta'
        })
      ]
    })

    expect(view.exchanges).toHaveLength(1)
    expect(view.exchanges[0]!.turnId).toBe('legacy-user')
    expect(view.exchanges[0]!.responses.map((response) => response.modelId)).toEqual([
      'alpha',
      'beta'
    ])
  })

  it('represents missing, streaming, interrupted, and errored responses', () => {
    const adapt = createDesktopChatTranscriptAdapter()
    const missing = adapt({ messages: [user()] })
    expect(missing.exchanges[0]!.status).toBe('idle')
    expect(missing.exchanges[0]!.responses).toEqual([])

    const streamingMessage = assistant({ content: 'Partial answer', selectedModelId: 'alpha' })
    const streamingInput = {
      messages: [user(), streamingMessage],
      streamingAssistantMessageId: streamingMessage.id
    }
    const firstStreaming = adapt(streamingInput)
    const secondStreaming = adapt(streamingInput)
    expect(firstStreaming.exchanges[0]!.status).toBe('streaming')
    expect(secondStreaming.exchanges[0]).not.toBe(firstStreaming.exchanges[0])

    const interrupted = adapt({
      messages: [user({ id: 'user-interrupted' }), streamingMessage],
      interruptedAssistantMessageId: streamingMessage.id
    })
    expect(interrupted.exchanges[0]!.status).toBe('interrupted')

    const errored = adapt({
      messages: [
        user({ id: 'user-error' }),
        assistant({
          responses: [
            {
              modelId: 'alpha',
              modelName: 'Alpha',
              provider: 'test',
              content: '',
              isLoading: false,
              error: 'Provider unavailable'
            }
          ]
        })
      ]
    })
    expect(errored.exchanges[0]!.status).toBe('error')
    expect(errored.exchanges[0]!.responses[0]!.errorMessage).toBe('Provider unavailable')
  })

  it('maps active desktop responses to submitted and executing-tool statuses', () => {
    const submitted = createDesktopChatTranscriptAdapter()({
      messages: [
        user(),
        assistant({
          responses: [
            {
              modelId: 'alpha',
              modelName: 'Alpha',
              provider: 'test',
              content: '',
              isLoading: true,
              status: 'submitted',
              renderParts: []
            }
          ]
        })
      ]
    })
    expect(submitted.exchanges[0]!.status).toBe('submitted')

    const executingTool = createDesktopChatTranscriptAdapter()({
      messages: [
        user(),
        assistant({
          responses: [
            {
              modelId: 'alpha',
              modelName: 'Alpha',
              provider: 'test',
              content: '',
              isLoading: true,
              renderParts: [
                {
                  type: 'tool',
                  id: 'tool-1',
                  toolCallId: 'tool-1',
                  toolName: 'search',
                  state: 'input-available'
                }
              ]
            }
          ]
        })
      ]
    })
    expect(executingTool.exchanges[0]!.status).toBe('executing-tool')
    expect(executingTool.exchanges[0]!.responses[0]!.status).toBe('executing-tool')

    const multiModelMessage = assistant({
      selectedModelId: 'alpha',
      responses: [
        {
          modelId: 'alpha',
          modelName: 'Alpha',
          provider: 'test',
          content: 'Alpha is done',
          isLoading: false,
          status: 'completed'
        },
        {
          modelId: 'beta',
          modelName: 'Beta',
          provider: 'test',
          content: '',
          isLoading: true,
          status: 'submitted'
        }
      ]
    })
    const multiModel = createDesktopChatTranscriptAdapter()({
      messages: [user(), multiModelMessage],
      streamingAssistantMessageId: multiModelMessage.id
    })
    expect(multiModel.exchanges[0]!.responses.map((response) => response.status)).toEqual([
      'completed',
      'submitted'
    ])
    expect(multiModel.exchanges[0]!.status).toBe('completed')
  })

  it('keeps 99 completed exchanges stable while the 100th receives 100 stream chunks', () => {
    const adapt = createDesktopChatTranscriptAdapter()
    const exchangeCount = 100
    const activeIndex = exchangeCount - 1
    const completedMessages = Array.from({ length: activeIndex }, (_, index) => [
      user({
        id: `user-${index}`,
        turnId: `turn-${index}`,
        content: `Prompt ${index}`
      }),
      assistant({
        id: `assistant-${index}`,
        turnId: `turn-${index}`,
        content: `Answer ${index}`,
        selectedModelId: 'alpha'
      })
    ]).flat()
    const activeUser = user({ id: 'user-active', turnId: 'turn-active' })
    let activeAssistant = assistant({
      id: 'assistant-active',
      turnId: 'turn-active',
      responses: [
        {
          modelId: 'alpha',
          modelName: 'Alpha',
          provider: 'test',
          content: '',
          isLoading: true,
          status: 'submitted'
        }
      ]
    })
    const first = adapt({
      messages: [...completedMessages, activeUser, activeAssistant]
    })
    const completedExchanges = first.exchanges.slice(0, activeIndex)
    let previousActiveExchange = first.exchanges[activeIndex]
    expect(first.exchanges).toHaveLength(exchangeCount)

    for (let chunk = 1; chunk <= 100; chunk += 1) {
      activeAssistant = {
        ...activeAssistant,
        responses: [
          {
            ...activeAssistant.responses![0]!,
            content: `chunk-${chunk}`,
            status: 'streaming'
          }
        ]
      }
      const next = adapt({
        messages: [...completedMessages, activeUser, activeAssistant]
      })
      for (let index = 0; index < activeIndex; index += 1) {
        expect(next.exchanges[index]).toBe(completedExchanges[index])
      }
      expect(next.exchanges[activeIndex]).not.toBe(previousActiveExchange)
      previousActiveExchange = next.exchanges[activeIndex]
    }
  })

  it('restores image and video generation results', () => {
    const results = [
      {
        type: 'image' as const,
        status: 'completed' as const,
        url: 'data:image/png;base64,AA=='
      }
    ]
    const view = createDesktopChatTranscriptAdapter()({
      messages: [user()],
      exchangeGenTypes: ['image'],
      generationResults: new Map([[0, results]])
    })

    expect(view.exchanges[0]!.status).toBe('completed')
    expect(view.exchanges[0]!.media).toEqual({ kind: 'image', results })

    const persistedView = createDesktopChatTranscriptAdapter()({
      messages: [
        {
          ...user(),
          generation: {
            kind: 'image',
            modelIds: ['image-model'],
            results
          }
        }
      ]
    })
    expect(persistedView.exchanges[0]!.generationMode).toBe('image')
    expect(persistedView.exchanges[0]!.media).toEqual({ kind: 'image', results })
  })
})
