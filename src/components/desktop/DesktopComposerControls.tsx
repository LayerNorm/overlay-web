'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Mic, Square } from 'lucide-react'
import { PromptInputButton } from '@overlay/chat-react'
import { useDesktopBridge } from './DesktopProvider'
import type { Input } from '@overlay/desktop-bridge'

export function DesktopComposerControls({ input, onInputChange, onImages }: { input: string; onInputChange: (value: string) => void; onImages: (files: File[]) => void }) {
  const desktop = useDesktopBridge()
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const recordingEpoch = useRef(0)
  const current = useRef({ input, onInputChange })
  useEffect(() => { current.current = { input, onInputChange } }, [input, onInputChange])
  useEffect(() => {
    const release = () => {
      recordingEpoch.current++
      if (recorder.current) recorder.current.onstop = null
      stream.current?.getTracks().forEach((track) => track.stop())
    }
    const cancel = () => { release(); setRecording(false) }
    const off = desktop?.bridge.on('transcription.cancel', cancel)
    return () => { off?.(); release() }
  }, [desktop])
  if (!desktop) return null
  const { bridge, info } = desktop
  const toggle = async () => {
    setError('')
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return }
    try {
      const epoch = ++recordingEpoch.current
      const status = await bridge.call('transcription.status', undefined)
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (epoch !== recordingEpoch.current) { stream.current.getTracks().forEach((track) => track.stop()); return }
      const capture = new MediaRecorder(stream.current)
      recorder.current = capture
      const chunks: Blob[] = []
      capture.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      capture.onstop = async () => {
        setRecording(false); stream.current?.getTracks().forEach((track) => track.stop())
        try {
          const audio = new Uint8Array(await new Blob(chunks).arrayBuffer())
          const result = await bridge.call('transcription.transcribe', { audio, mime: capture.mimeType.split(';')[0] as Input<'transcription.transcribe'>['mime'], model: status.model as Input<'transcription.transcribe'>['model'] })
          if (epoch !== recordingEpoch.current) return
          const latest = current.current
          latest.onInputChange(`${latest.input}${latest.input && !/\s$/.test(latest.input) ? ' ' : ''}${result.text}`)
        } catch (err) { setError(err instanceof Error ? err.message : 'Dictation failed.') }
      }
      capture.start(); setRecording(true)
    } catch { stream.current?.getTracks().forEach((track) => track.stop()); setError('Could not start dictation. Check microphone permissions in Desktop settings.') }
  }
  return <>
    {info.capabilities.includes('transcription') ? <PromptInputButton aria-label={recording ? 'Stop dictation' : 'Dictate message'} onClick={() => void toggle()}>{recording ? <Square size={16} /> : <Mic size={16} />}</PromptInputButton> : null}
    {info.capabilities.includes('capture') ? <PromptInputButton aria-label="Attach screenshot" onClick={() => {
      setError('')
      void bridge.call('capture.screenshot', {}).then(async (shot) => {
        const blob = await (await fetch(shot.dataUrl)).blob()
        onImages([new File([blob], shot.name, { type: blob.type })])
      }).catch(() => setError('Could not capture the screen. Check Screen Recording permissions in System Settings.'))
    }}><Camera size={16} /></PromptInputButton> : null}
    {error ? <span role="alert" className="max-w-64 text-xs text-destructive">{error}</span> : null}
  </>
}
