import { useState, useEffect } from 'react'
import { Transcription } from '../../../types/transcription'
import { PhrasePair } from './useSettings'
import { analytics } from '../services/analytics'
import { applyPhraseReplacements } from '../utils/phrase-replacements'

const TRANSCRIPTIONS_STORAGE_KEY = 'transcriptions'

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

type RawTranscription = {
  id?: unknown
  text?: unknown
  timestamp?: unknown
  wordsIn?: unknown
  wordsOut?: unknown
  duration?: unknown
}

// Transcription from the main process
const normalizeTranscription = (
  raw: RawTranscription,
  phraseReplacements: PhrasePair[] = []
): Transcription => {
  const originalText = typeof raw?.text === 'string' ? raw.text : ''
  const processedText = applyPhraseReplacements(originalText, phraseReplacements)

  return {
    id:
      typeof raw?.id === 'string'
        ? raw.id
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    text: processedText,
    timestamp: typeof raw?.timestamp === 'number' ? raw.timestamp : Date.now(),
    wordsIn: toNumber(raw?.wordsIn),
    wordsOut: toNumber(raw?.wordsOut),
    duration: toNumber(raw?.duration)
  }
}

// Transcriptions from the renderer process
export function useTranscriptions(phraseReplacements: PhrasePair[] = []): {
  transcriptions: Transcription[]
} {
  const [transcriptions, setTranscriptions] = useState<Transcription[]>(() => {
    const saved = localStorage.getItem(TRANSCRIPTIONS_STORAGE_KEY)
    if (!saved) return []
    try {
      const parsed = JSON.parse(saved)
      if (!Array.isArray(parsed)) return []
      return parsed.map((raw) => normalizeTranscription(raw, phraseReplacements))
    } catch (error) {
      console.error('Failed to parse saved transcriptions:', error)
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(TRANSCRIPTIONS_STORAGE_KEY, JSON.stringify(transcriptions))
  }, [transcriptions])

  useEffect(() => {
    const unsubscribe = window.bridge?.onTranscriptionAdd?.((transcription) => {
      const normalized = normalizeTranscription(transcription, phraseReplacements)
      analytics.increment('transcriptions_done')
      setTranscriptions((prev) => [normalized, ...prev])
    })
    return unsubscribe
  }, [phraseReplacements])

  return { transcriptions }
}
