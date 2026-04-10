import { useState, useCallback, useRef } from 'react'
import { Alert } from 'react-native'
import * as Haptics from 'expo-haptics'
import {
  startRecording as startAudioRecording,
  stopRecording as stopAudioRecording,
  cancelRecording as cancelAudioRecording,
  transcribeAudio,
  cleanupAudioFile
} from '../services/transcriptionService'

export interface VoiceInputResult {
  text: string
  duration: number
}

interface UseVoiceInputReturn {
  isRecording: boolean
  isProcessing: boolean
  error: string | null
  startRecording: () => Promise<void>
  stopRecording: () => Promise<VoiceInputResult | null>
  cancelRecording: () => void
  toggleRecording: () => Promise<VoiceInputResult | null>
}

export function useVoiceInput(): UseVoiceInputReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isRecordingRef = useRef(false)

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null)

    try {
      await startAudioRecording()
      isRecordingRef.current = true
      setIsRecording(true)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start recording'
      setError(message)
      Alert.alert('Voice Input', message)
    }
  }, [])

  const stopRecording = useCallback(async (): Promise<VoiceInputResult | null> => {
    if (!isRecordingRef.current) return null

    setError(null)
    isRecordingRef.current = false
    setIsRecording(false)
    setIsProcessing(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    try {
      const result = await stopAudioRecording()
      if (!result) {
        setIsProcessing(false)
        return null
      }

      const { uri, duration } = result

      // Transcribe via Groq Whisper API
      const text = await transcribeAudio(uri)

      // Clean up temp audio file
      await cleanupAudioFile(uri)

      setIsProcessing(false)

      if (!text) {
        setError('No speech detected')
        return null
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      return { text, duration }
    } catch (err) {
      setIsProcessing(false)
      const message = err instanceof Error ? err.message : 'Transcription failed'
      setError(message)
      console.error('[useVoiceInput] Stop/transcribe error:', message)
      Alert.alert('Voice Input', message)
      return null
    }
  }, [])

  const cancelRecording = useCallback((): void => {
    isRecordingRef.current = false
    setIsRecording(false)
    setIsProcessing(false)
    setError(null)
    cancelAudioRecording()
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [])

  const toggleRecording = useCallback(async (): Promise<VoiceInputResult | null> => {
    if (isRecordingRef.current) {
      return await stopRecording()
    } else {
      await startRecording()
      return null
    }
  }, [startRecording, stopRecording])

  return {
    isRecording,
    isProcessing,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
    toggleRecording
  }
}
