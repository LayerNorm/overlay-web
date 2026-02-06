import { useState, useCallback } from 'react'

export interface VoiceInputResult {
  text: string
  duration: number
}

interface UseVoiceInputReturn {
  isRecording: boolean
  isProcessing: boolean
  startRecording: () => Promise<void>
  stopRecording: () => Promise<VoiceInputResult | null>
  cancelRecording: () => void
}

export function useVoiceInput(): UseVoiceInputReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const startRecording = useCallback(async (): Promise<void> => {
    // TODO: Implement with whisper.rn or expo-speech in Phase 4
    setIsRecording(true)
  }, [])

  const stopRecording = useCallback(async (): Promise<VoiceInputResult | null> => {
    // TODO: Implement with whisper.rn or expo-speech in Phase 4
    setIsRecording(false)
    setIsProcessing(true)

    // Placeholder - will return transcribed text in Phase 4
    setIsProcessing(false)
    return null
  }, [])

  const cancelRecording = useCallback((): void => {
    // TODO: Implement cancellation in Phase 4
    setIsRecording(false)
    setIsProcessing(false)
  }, [])

  return {
    isRecording,
    isProcessing,
    startRecording,
    stopRecording,
    cancelRecording
  }
}
