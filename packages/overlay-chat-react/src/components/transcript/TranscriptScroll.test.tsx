import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APPROVED_CLASS_B_WEB_DIFFERENCES,
  DEFAULT_CHAT_TRANSCRIPT_PRESENTATION,
} from './ChatTranscript'
import {
  isTranscriptNearBottom,
  submittedExchangeReservedSpace,
  submittedExchangeScrollTop,
  streamingTranscriptReservedSpace,
  streamingTranscriptTailHeight,
  transcriptDistanceFromBottom,
} from './TranscriptScroll'

test('Class B defaults and approved web differences stay explicit', () => {
  assert.equal(DEFAULT_CHAT_TRANSCRIPT_PRESENTATION.actionVisibility, 'hover')
  assert.equal(DEFAULT_CHAT_TRANSCRIPT_PRESENTATION.showActions, true)
  assert.deepEqual(
    APPROVED_CLASS_B_WEB_DIFFERENCES.map((difference) => difference.id),
    [
      'exchange-actions-hover-focus',
      'status-driven-loading',
      'intent-preserving-autoscroll',
    ],
  )
})
test('near-bottom intent uses the shared threshold without negative distances', () => {
  assert.equal(transcriptDistanceFromBottom({ scrollHeight: 1_000, scrollTop: 700, clientHeight: 250 }), 50)
  assert.equal(transcriptDistanceFromBottom({ scrollHeight: 100, scrollTop: 20, clientHeight: 120 }), 0)
  assert.equal(isTranscriptNearBottom({ scrollHeight: 1_000, scrollTop: 650, clientHeight: 250 }), false)
  assert.equal(isTranscriptNearBottom({ scrollHeight: 1_000, scrollTop: 654, clientHeight: 250 }), true)
})

test('active transcript tail reserve scales and clamps with the viewport', () => {
  assert.equal(streamingTranscriptTailHeight(500), 160)
  assert.equal(streamingTranscriptTailHeight(1_000), 200)
  assert.equal(streamingTranscriptTailHeight(2_000), 240)
  assert.equal(streamingTranscriptReservedSpace(1_000), 800)
})

test('submitted exchange reserve shrinks as the response grows without moving its start', () => {
  assert.equal(submittedExchangeReservedSpace(800, 64), 720)
  assert.equal(submittedExchangeReservedSpace(800, 784), 0)
  assert.equal(submittedExchangeReservedSpace(800, 900), 0)
})

test('submitted exchange top alignment is one-shot and independent of response height', () => {
  assert.equal(submittedExchangeScrollTop({
    containerTop: 100,
    exchangeTop: 640,
    currentScrollTop: 300,
  }), 824)
  assert.equal(submittedExchangeScrollTop({
    containerTop: 100,
    exchangeTop: 108,
    currentScrollTop: 0,
  }), 0)
})
