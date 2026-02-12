import { Audio } from 'expo-av'
import { File } from 'expo-file-system'
import { getApiKey } from './aiService'

export interface TranscriptionResult {
  text: string
  duration: number
}

let recording: Audio.Recording | null = null
let recordingStartTime: number = 0

/**
 * Request microphone permissions. Returns true if granted.
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  const { status } = await Audio.requestPermissionsAsync()
  return status === 'granted'
}

/**
 * Start recording audio. Configures for high-quality speech input
 * optimized for the Groq Whisper API (m4a/aac on iOS).
 */
export async function startRecording(): Promise<void> {
  const hasPermission = await requestMicrophonePermission()
  if (!hasPermission) {
    throw new Error('Microphone permission not granted')
  }

  // Stop any existing recording
  if (recording) {
    try {
      await recording.stopAndUnloadAsync()
    } catch {
      // ignore
    }
    recording = null
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true
  })

  const { recording: newRecording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY
  )

  recording = newRecording
  recordingStartTime = Date.now()
}

/**
 * Stop recording and return the file URI + duration.
 * Does NOT transcribe — call transcribeAudio() separately.
 */
export async function stopRecording(): Promise<{ uri: string; duration: number } | null> {
  if (!recording) return null

  const duration = (Date.now() - recordingStartTime) / 1000

  try {
    await recording.stopAndUnloadAsync()
  } catch {
    // ignore
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false
  })

  const uri = recording.getURI()
  recording = null

  if (!uri) return null

  return { uri, duration }
}

/**
 * Cancel an active recording without transcribing.
 */
export async function cancelRecording(): Promise<void> {
  if (!recording) return

  try {
    await recording.stopAndUnloadAsync()
  } catch {
    // ignore
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false
  })

  const uri = recording.getURI()
  recording = null

  // Clean up the temp file
  if (uri) {
    try {
      const file = new File(uri)
      if (file.exists) {
        file.delete()
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Check if there is an active recording in progress.
 */
export function isCurrentlyRecording(): boolean {
  return recording !== null
}

/**
 * Transcribe an audio file using the Groq Whisper API.
 * Mirrors the desktop's transcribeWithGroq logic from transcription-ipc.ts.
 *
 * Uses the new expo-file-system File class (which implements Blob)
 * with fetch + FormData for the multipart upload.
 */
export async function transcribeAudio(fileUri: string): Promise<string> {
  const groqApiKey = await getApiKey('groq')
  if (!groqApiKey) {
    throw new Error('No Groq API key configured. Add it in Settings.')
  }

  const audioFile = new File(fileUri)
  if (!audioFile.exists) {
    throw new Error('Recording file not found')
  }

  // Determine file extension and mime type
  const ext = fileUri.split('.').pop()?.toLowerCase() || 'm4a'
  const mimeMap: Record<string, string> = {
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    wav: 'audio/wav',
    webm: 'audio/webm',
    caf: 'audio/x-caf'
  }
  const mimeType = mimeMap[ext] || 'audio/mp4'
  const fileName = `recording.${ext}`

  let retries = 3
  while (retries > 0) {
    try {
      const formData = new FormData()
      // React Native FormData expects {uri, name, type} for file uploads
      formData.append('file', {
        uri: fileUri,
        name: fileName,
        type: mimeType
      } as any)
      formData.append('model', 'whisper-large-v3-turbo')
      formData.append('temperature', '0')
      formData.append('response_format', 'verbose_json')

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groqApiKey}`
        },
        body: formData
      })

      if (response.ok) {
        const result = await response.json()
        console.log('[Transcription] Groq transcription successful')
        return (result.text || '').trim()
      }

      // Handle rate limiting or server errors with retry
      if (response.status === 429 || response.status >= 500) {
        retries--
        if (retries > 0) {
          console.log(
            `[Transcription] Groq error ${response.status}, retrying... (${retries} left)`
          )
          await new Promise((resolve) => setTimeout(resolve, 1000))
          continue
        }
      }

      const errText = await response.text()
      throw new Error(`Groq API error (${response.status}): ${errText}`)
    } catch (error) {
      retries--
      if (retries === 0) {
        throw error
      }
      console.log(`[Transcription] Request failed, retrying... (${retries} left)`)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  throw new Error('Transcription failed after 3 attempts')
}

/**
 * Clean up a temporary audio file after transcription.
 */
export async function cleanupAudioFile(uri: string): Promise<void> {
  try {
    const file = new File(uri)
    if (file.exists) {
      file.delete()
    }
    console.log('[Transcription] Cleaned up audio file')
  } catch {
    console.warn('[Transcription] Failed to cleanup audio file')
  }
}
