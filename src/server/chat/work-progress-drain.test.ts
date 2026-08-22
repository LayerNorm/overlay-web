import assert from 'node:assert/strict'
import test from 'node:test'
import {
  drainWorkProgress,
  WORK_PROGRESS_FLUSH_CHARS,
  WORK_PROGRESS_FLUSH_INTERVAL_MS,
} from './work-progress-drain'

const recorded: string[] = []
let failNext = false

const publish = async (content: string) => {
  if (failNext) {
    failNext = false
    throw new Error('write failed')
  }
  recorded.push(content)
}

function streamOf(chunks: Array<Record<string, unknown>>) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  }) as unknown as ReadableStream<never>
}

function delta(text: string) {
  return { type: 'text-delta', id: 't1', delta: text }
}

test.beforeEach(() => {
  recorded.length = 0
  failNext = false
})

test('published content is absolute, so a racing writer converges', async () => {
  await drainWorkProgress(streamOf([delta('a'.repeat(WORK_PROGRESS_FLUSH_CHARS)), delta('bb')]), {
    now: () => 0,
    publish,
    runId: 'run_1',
  })

  // Each write carries the whole reply so far, never a fragment to append.
  assert.equal(recorded.at(0), 'a'.repeat(WORK_PROGRESS_FLUSH_CHARS))
  assert.equal(recorded.at(-1), `${'a'.repeat(WORK_PROGRESS_FLUSH_CHARS)}bb`)
})

test('short text waits for the interval rather than costing a write per token', async () => {
  let clock = 0
  await drainWorkProgress(streamOf([delta('a'), delta('b'), delta('c')]), {
    now: () => clock,
    publish,
    runId: 'run_1',
  })
  // Only the terminal flush: nothing crossed either threshold mid-stream.
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0], 'abc')

  recorded.length = 0
  clock = 0
  const ticking = () => {
    clock += WORK_PROGRESS_FLUSH_INTERVAL_MS
    return clock
  }
  await drainWorkProgress(streamOf([delta('a'), delta('b')]), {
    now: ticking,
    publish,
    runId: 'run_1',
  })
  assert.ok(recorded.length > 1)
})

test('a turn that produced no text writes nothing', async () => {
  await drainWorkProgress(streamOf([{ type: 'start' }, { type: 'finish' }]), {
    now: () => 0,
    publish,
    runId: 'run_1',
  })
  assert.deepEqual(recorded, [])
})

test('a failed write ends the drain without throwing into the request', async () => {
  failNext = true
  await drainWorkProgress(streamOf([delta('x'.repeat(WORK_PROGRESS_FLUSH_CHARS)), delta('y')]), {
    now: () => 0,
    publish,
    runId: 'run_1',
  })
  // The reply still lands through the workflow; this only stops publishing.
  assert.deepEqual(recorded, [])
})
