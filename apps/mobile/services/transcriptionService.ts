import { Audio } from 'expo-av'
import { File } from 'expo-file-system'
import { appJson, appRequest } from './appApi'

export interface TranscriptionResult {
  text: string
  duration: number
}

let recording: Audio.Recording | null = null
let recordingStartTime = 0

export async function requestMicrophonePermission(): Promise<boolean> {
  const { status } = await Audio.requestPermissionsAsync()
  return status === 'granted'
}

export async function startRecording(): Promise<void> {
  const hasPermission = await requestMicrophonePermission()
  if (!hasPermission) {
    throw new Error('Microphone permission not granted')
  }

  if (recording) {
    try {
      await recording.stopAndUnloadAsync()
    } catch {
      // ignore stale recorder
    }
    recording = null
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  })

  const { recording: nextRecording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY,
  )

  recording = nextRecording
  recordingStartTime = Date.now()
}

export async function stopRecording(): Promise<{ uri: string; duration: number } | null> {
  if (!recording) return null

  const duration = (Date.now() - recordingStartTime) / 1000

  try {
    await recording.stopAndUnloadAsync()
  } catch {
    // ignore
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
  })

  const uri = recording.getURI()
  recording = null

  if (!uri) return null
  return { uri, duration }
}

export async function cancelRecording(): Promise<void> {
  if (!recording) return

  try {
    await recording.stopAndUnloadAsync()
  } catch {
    // ignore
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
  })

  const uri = recording.getURI()
  recording = null

  if (uri) {
    await cleanupAudioFile(uri)
  }
}

export function isCurrentlyRecording(): boolean {
  return recording !== null
}

export async function transcribeAudio(fileUri: string): Promise<string> {
  const audioFile = new File(fileUri)
  if (!audioFile.exists) {
    throw new Error('Recording file not found')
  }

  const ext = fileUri.split('.').pop()?.toLowerCase() || 'm4a'
  const mimeMap: Record<string, string> = {
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    wav: 'audio/wav',
    webm: 'audio/webm',
    caf: 'audio/x-caf',
  }
  const mimeType = mimeMap[ext] || 'audio/mp4'
  const formData = new FormData()
  formData.append(
    'audio',
    {
      uri: fileUri,
      name: `recording.${ext}`,
      type: mimeType,
    } as never,
  )

  const response = await appRequest('/api/app/transcribe', {
    method: 'POST',
    formData,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || 'Transcription failed')
  }

  const payload = (await response.json()) as { text?: string }
  return (payload.text || '').trim()
}

export async function cleanupAudioFile(uri: string): Promise<void> {
  try {
    const file = new File(uri)
    if (file.exists) {
      file.delete()
    }
  } catch {
    // ignore cleanup failures
  }
}
