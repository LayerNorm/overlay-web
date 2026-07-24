export interface Transcription {
  id: string
  text: string
  timestamp: number
  wordsIn: number
  wordsOut: number
  duration: number
}

export interface TranscriptionStats {
  totalWords: number
  totalTranscriptions: number
  currentStreak: number
  averageWPM: number
}
