import { createRequire } from 'node:module'
import { act, createElement, useEffect, type ReactElement } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { useNotebookAgent } from './editor-state'

vi.mock('@overlay/ui/primitives', () => ({ toast: vi.fn() }))
vi.mock('./slash-menu-items', () => ({ createSlashMenuItems: vi.fn() }))

type Renderer = { update(element: ReactElement): void; unmount(): void }
const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: ReactElement): Renderer
}
let renderer: Renderer | undefined
afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  renderer = undefined
  vi.unstubAllGlobals()
})

const accepted = { type: 'accepted', runId: 'run', conversationId: 'conversation', turnId: 'turn' }
const proposal = {
  type: 'edit_proposal', eventId: 'proposal',
  edit: { id: 'edit', description: 'Replace line', startLine: 1, endLine: 1, originalLines: ['one'], newLines: ['two'] },
}
const final = { type: 'text', text: 'The edit is proposed for review.', eventId: 'final' }
const done = { type: 'done', eventId: 'done' }
const encode = (events: unknown[]) => new TextEncoder().encode(events.map(event => JSON.stringify(event)).join('\n') + '\n')

async function mount(runAgent: Parameters<typeof useNotebookAgent>[0]['runAgent']) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const addDiffProposal = vi.fn()
  const editor = {
    commands: { clearAllDiffs: vi.fn() },
    getHTML: () => '<p>one</p>',
    state: { doc: { forEach: (callback: (node: { textContent: string }) => void) => callback({ textContent: 'one' }) } },
    chain: () => ({ focus: () => ({ addDiffProposal: (edit: unknown) => {
      addDiffProposal(edit)
      return { run: vi.fn() }
    } }) }),
  }
  const props: Parameters<typeof useNotebookAgent>[0] = {
    runAgent, stopAgent: vi.fn(async () => {}),
    editor: editor as unknown as Parameters<typeof useNotebookAgent>[0]['editor'],
    activeNote: { _id: 'note', title: 'Note', content: 'one', tags: [], createdAt: 1, updatedAt: 1 },
    title: 'Note', titleRef: { current: 'Note' }, initialModelId: 'model', flushSaveRef: { current: async () => {} },
  }
  let agent!: ReturnType<typeof useNotebookAgent>
  function Harness(next: typeof props) {
    const currentAgent = useNotebookAgent(next)
    useEffect(() => { agent = currentAgent }, [currentAgent])
    return null
  }
  await act(async () => { renderer = create(createElement(Harness, props)) })
  await act(async () => { agent.setAgentInput('Replace the line') })
  return {
    props, addDiffProposal,
    get agent() { return agent },
    update: async () => { await act(async () => { renderer!.update(createElement(Harness, props)) }) },
  }
}

test('batched stale-proposal error and final text survive run completion', async () => {
  const fixture = await mount(async () => {
    fixture.props.titleRef.current = 'Renamed after admission'
    return new Response(encode([accepted, proposal, final, done]))
  })
  await act(async () => { await fixture.agent.runNotebookAgent() })
  expect(fixture.agent.agentRunning).toBe(false)
  expect(fixture.agent.agentItems).toContainEqual({
    type: 'error', text: 'The note changed after this run started. Rerun the request before applying its proposal.',
  })
  expect(fixture.agent.agentItems).toContainEqual({ type: 'text', text: final.text })
  expect(fixture.addDiffProposal).not.toHaveBeenCalled()
})

test('late events from a previous note cannot populate the next note after navigation', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const fixture = await mount(async () => new Response(new ReadableStream<Uint8Array>({
    start(next) { controller = next; controller.enqueue(encode([accepted])) },
  })))
  let running!: Promise<void>
  await act(async () => { running = fixture.agent.runNotebookAgent() })
  fixture.props.activeNote = { ...fixture.props.activeNote!, _id: 'other-note', title: 'Other' }
  await fixture.update()
  await act(async () => {
    controller.enqueue(encode([proposal, final, done]))
    controller.close()
    await running
  })
  expect(fixture.agent.agentRunning).toBe(false)
  expect(fixture.agent.agentItems).toEqual([])
  expect(fixture.addDiffProposal).not.toHaveBeenCalled()
  expect(fixture.props.stopAgent).toHaveBeenCalledWith({ conversationId: 'conversation', runId: 'run', turnId: 'turn' })
})
