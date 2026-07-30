import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GROQ_WHISPER_TURBO_USD_PER_HOUR,
  transcriptionProviderCostUsd,
  trustedTranscriptionDurationSeconds,
} from './transcription-billing'

test('uses provider duration when present', () => {
  assert.equal(trustedTranscriptionDurationSeconds({ duration: 42.5 }), 42.5)
})

test('falls back to the greatest trusted segment end', () => {
  assert.equal(trustedTranscriptionDurationSeconds({
    segments: [{ end: 2.5 }, { end: 7.25 }, { end: 'untrusted' }],
  }), 7.25)
})

test('rejects responses without trusted duration metadata', () => {
  assert.equal(trustedTranscriptionDurationSeconds({ duration: '60', segments: [] }), null)
})

test('applies the provider minimum and hourly price', () => {
  assert.equal(transcriptionProviderCostUsd(0), (10 / 3600) * GROQ_WHISPER_TURBO_USD_PER_HOUR)
  assert.equal(transcriptionProviderCostUsd(3600), GROQ_WHISPER_TURBO_USD_PER_HOUR)
})

