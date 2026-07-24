import { describe, expect, it } from 'vitest'
import { createDesktopChatTranscriptAdapter } from './desktopChatTranscriptAdapter'
import { embeddedChatItemsToMessages } from './embeddedChatTranscriptAdapter'

describe('embedded chat transcript adapter', () => {
  it('groups embedded items into stable canonical turns in source order', () => {
    const messages = embeddedChatItemsToMessages(
      [
        { type: 'user', text: 'Inspect this page' },
        { type: 'thinking', text: 'Reviewing the page' },
        { type: 'tool_call', tool: 'browser_read_page', toolResult: 'Ready' },
        { type: 'text', text: 'The page is ready.' }
      ],
      { idPrefix: 'browser', isRunning: false, mode: 'ask', modelId: 'model-a' }
    )

    expect(messages.map((message) => message.id)).toEqual([
      'browser:turn:0:user',
      'browser:turn:0:assistant'
    ])
    expect(messages[1]?.renderParts?.map((part) => part.type)).toEqual([
      'reasoning',
      'tool',
      'text'
    ])
    expect(messages[1]?.selectedModelId).toBe('model-a')
    expect(messages[1]?.status).toBe('completed')

    const transcript = createDesktopChatTranscriptAdapter()({ messages })
    expect(transcript.exchanges[0]?.responses[0]?.blocks.map((block) => block.kind)).toEqual([
      'reasoning',
      'tool',
      'text'
    ])
  })

  it('maps active tools and empty runs to shared loading statuses', () => {
    const executing = embeddedChatItemsToMessages(
      [
        { type: 'user', text: 'Do this' },
        { type: 'tool_call', tool: 'browser_click', isLoading: true }
      ],
      { idPrefix: 'browser', isRunning: true, mode: 'act' }
    )
    const submitted = embeddedChatItemsToMessages([{ type: 'user', text: 'Do this' }], {
      idPrefix: 'notebook',
      isRunning: true,
      mode: 'act'
    })

    expect(executing[1]?.status).toBe('executing-tool')
    expect(executing[1]?.isAgentMessage).toBe(true)
    expect(submitted[1]?.status).toBe('submitted')
  })

  it('uses live plan state and preserves failed status', () => {
    const messages = embeddedChatItemsToMessages(
      [
        { type: 'user', text: 'Run the plan' },
        { type: 'plan', steps: [{ id: 1, text: 'Old step', status: 'pending' }] },
        { type: 'error', text: 'Provider stopped' }
      ],
      {
        idPrefix: 'browser',
        isRunning: false,
        mode: 'act',
        planSteps: [{ id: 1, text: 'Current step', status: 'completed' }]
      }
    )

    expect(messages[1]?.content).toContain('[x] Current step')
    expect(messages[1]?.content).toContain('Task failed: Provider stopped')
    expect(messages[1]?.status).toBe('error')
  })
})
