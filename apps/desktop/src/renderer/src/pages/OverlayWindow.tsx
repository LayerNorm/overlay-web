import { useEffect, useRef, useState, useCallback, ReactElement } from 'react'
import { Notebook, Mic, MessageCircle, Square, Pause, Play, Globe, RefreshCw } from 'lucide-react'
import DockablePanel from '../components/DockablePanel'
import { useDockableDrag } from '../components/DockablePanelContext'
import { analytics } from '../services/analytics'
import { applyPhraseReplacements } from '../utils/phrase-replacements'

const IDLE_WIDTH = 40
const IDLE_HEIGHT = 8
const EXPANDED_WIDTH = 176
const ERROR_WIDTH = 184
const EXPANDED_HEIGHT = 44
const RECORDING_WIDTH = 70
const RECORDING_HEIGHT = 28
const MIC_RECORDING_WIDTH = EXPANDED_WIDTH
const MIC_RECORDING_HEIGHT = EXPANDED_HEIGHT
const WAVEFORM_BAR_COUNT = 13
const WAVEFORM_BAR_WIDTH = 2.5
const WAVEFORM_BAR_MAX_HEIGHT = 15
const WAVEFORM_GAP = 1.5

function WaveformBars({
  levels,
  isVertical,
  bouncing = false
}: {
  levels?: number[]
  isVertical: boolean
  bouncing?: boolean
}): ReactElement {
  const bars = levels ?? Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isVertical ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: WAVEFORM_GAP,
        flexShrink: 0,
        animation: bouncing ? undefined : 'fadeScaleIn 0.15s ease-out'
      }}
    >
      {bars.map((level, i) => {
        const amp = bouncing ? 2 : Math.max(2, level * WAVEFORM_BAR_MAX_HEIGHT)
        return (
          <div
            key={i}
            style={{
              width: isVertical ? amp : WAVEFORM_BAR_WIDTH,
              height: isVertical ? WAVEFORM_BAR_WIDTH : amp,
              background: '#fff',
              borderRadius: 1,
              transition: bouncing
                ? undefined
                : isVertical
                  ? 'width 0.05s ease'
                  : 'height 0.05s ease',
              animation: bouncing
                ? `${isVertical ? 'waveBounceVertical' : 'waveBounce'} 1.6s ease-in-out infinite`
                : undefined,
              animationDelay: bouncing ? `${i * 0.08}s` : undefined
            }}
          />
        )
      })}
    </div>
  )
}
function getSupportedMimeType(): string | undefined {
  const types = [
    'audio/mp4',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/webm;codecs=opus',
    'audio/webm'
  ]
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return undefined
}

interface OverlayDockContextBridgeProps {
  children: (ctx: ReturnType<typeof useDockableDrag>) => ReactElement
  onDraggingChange: (isDragging: boolean) => void
}

function OverlayDockContextBridge({
  children,
  onDraggingChange
}: OverlayDockContextBridgeProps): ReactElement {
  const ctx = useDockableDrag()

  useEffect(() => {
    onDraggingChange(ctx.isDragging)
  }, [ctx.isDragging, onDraggingChange])

  return children(ctx)
}

export function OverlayWindow(): ReactElement {
  const [recording, setRecording] = useState(false)
  const [audioLevels, setAudioLevels] = useState(Array(WAVEFORM_BAR_COUNT).fill(0))
  const [isHovered, setIsHovered] = useState(true)
  const [openPanels, setOpenPanels] = useState<Set<'notebook' | 'chat' | 'browser'>>(new Set())
  const [activePanel, setActivePanel] = useState<'notebook' | 'chat' | 'browser' | null>(null)
  const [showButtons, setShowButtons] = useState(true)
  const [recordingSource, setRecordingSource] = useState<'hotkey' | 'mic' | null>(null)
  const [, setOpeningPanel] = useState<'notebook' | 'chat' | 'browser' | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [transcriptionError, setTranscriptionError] = useState(false)
  const [agentStatus, setAgentStatus] = useState<'thinking' | 'done' | 'error' | null>(null)
  const [agentSummary, setAgentSummary] = useState('')
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const agentToastTimerRef = useRef<NodeJS.Timeout | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const isMouseOverWidgetRef = useRef(false)
  const transcriptionErrorRef = useRef(false)
  const recordingSourceRef = useRef<'hotkey' | 'mic' | null>(null)
  const lastRecordingRef = useRef<{ blob: Blob; source: 'hotkey' | 'mic' | null; duration: number } | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recorderChunksRef = useRef<Blob[]>([])
  const onStopResolveRef = useRef<((blob: Blob | null) => void) | null>(null)
  const isRecordingCanceledRef = useRef(false)

  // Mouse enter/leave handlers for the widget container
  const handleWidgetMouseEnter = useCallback((): void => {
    isMouseOverWidgetRef.current = true
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    if (!recording) {
      setIsHovered(true)
      setShowButtons(true)
    }
    window.bridge.setIgnoreMouseEvents(false)
  }, [recording])

  const handleWidgetMouseMove = useCallback((): void => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
  }, [])

  const handleWidgetMouseLeave = useCallback((dragging: boolean): void => {
    isMouseOverWidgetRef.current = false
    if (dragging) return
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    hoverTimeoutRef.current = setTimeout(() => {
      hoverTimeoutRef.current = null
      setTranscriptionError(false)
      transcriptionErrorRef.current = false
      setIsHovered(false)
      setShowButtons(false)
    }, 300)
    // The overlay BrowserWindow covers the full display. Always restore
    // click-through on leave, including in retry state, or its transparent
    // pixels swallow clicks intended for every other app.
    window.bridge.setIgnoreMouseEvents(true)
  }, [])

  useEffect(() => {
    const collapseRetryOnBlur = (): void => {
      if (!transcriptionErrorRef.current) return
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
      setTranscriptionError(false)
      transcriptionErrorRef.current = false
      setIsHovered(false)
      setShowButtons(false)
      window.bridge.setIgnoreMouseEvents(true)
    }

    window.addEventListener('blur', collapseRetryOnBlur)
    return () => window.removeEventListener('blur', collapseRetryOnBlur)
  }, [])

  // Start expanded on load — collapse to idle after 5 s if user hasn't interacted
  useEffect(() => {
    const t = setTimeout(() => {
      if (transcriptionErrorRef.current) return
      if (!isMouseOverWidgetRef.current) {
        setIsHovered(false)
        setShowButtons(false)
      }
    }, 5000)
    return () => clearTimeout(t)
  }, [])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
      if (agentToastTimerRef.current) clearTimeout(agentToastTimerRef.current)
    }
  }, [])

  // Agent event listeners
  useEffect(() => {
    const offStart = window.bridge?.onAgentStart?.(() => {
      if (agentToastTimerRef.current) clearTimeout(agentToastTimerRef.current)
      setAgentStatus('thinking')
      setAgentSummary('')
    })
    const offDone = window.bridge?.onAgentDone?.((data) => {
      setAgentStatus('done')
      setAgentSummary(data.summary)
      agentToastTimerRef.current = setTimeout(() => setAgentStatus(null), 5000)
    })
    const offError = window.bridge?.onAgentError?.((data) => {
      setAgentStatus('error')
      setAgentSummary(data.error)
      agentToastTimerRef.current = setTimeout(() => setAgentStatus(null), 5000)
    })
    return () => {
      offStart?.()
      offDone?.()
      offError?.()
    }
  }, [])

  // Toggle panel windows - unified hide/show behavior
  // Hides all windows if any are visible, shows all windows if all are hidden
  const togglePanel = async (panel: 'notebook' | 'chat' | 'browser'): Promise<void> => {
    setOpeningPanel(panel)
    setShowButtons(true)

    // For chat/notebook panel opening, check for selected text first
    // Only do this if panels are currently hidden (will be shown)
    const visibilityCheck = await window.bridge.isPanelVisible(panel)
    console.log(`[OverlayWindow] ${panel} visibility check:`, visibilityCheck)

    if (!visibilityCheck.isVisible && (panel === 'chat' || panel === 'notebook')) {
      try {
        const result = await window.bridge.detectSelectedText()
        if (result.success && result.hasSelection && result.selectedText.trim()) {
          // Open panel with selected text
          console.log(`[OverlayWindow] Detected selected text, opening new ${panel}`)
          if (panel === 'chat') {
            await window.bridge.sendTextToNewChat(result.selectedText)
          } else {
            await window.bridge.sendTextToNewNote(result.selectedText)
          }
          setOpenPanels((prev) => new Set(prev).add(panel))
          setActivePanel(panel)
          setOpeningPanel(null)
          setShowButtons(true)
          return
        }
      } catch (error) {
        console.error('[OverlayWindow] Failed to detect selected text:', error)
      }
    }

    // Toggle panel visibility (hide all if any visible, show all if all hidden)
    const toggleResult = await window.bridge.togglePanelWindow(panel, true)
    console.log(`[OverlayWindow] Toggle ${panel} result:`, toggleResult)

    // Update UI state based on whether panels are now visible or hidden
    if (toggleResult.isVisible) {
      // Panels are now visible
      setOpenPanels((prev) => new Set(prev).add(panel))
      setActivePanel(panel)
    } else {
      // Panels are now hidden
      setOpenPanels((prev) => {
        const next = new Set(prev)
        next.delete(panel)
        return next
      })
      if (activePanel === panel) {
        setActivePanel(null)
      }
    }

    setOpeningPanel(null)
    setShowButtons(true)
  }

  const streamRef = useRef<MediaStream | null>(null)
  const recordingRef = useRef(false)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationRef = useRef<number | null>(null)
  const recordingStartTimeRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const isSettingUpRef = useRef(false) // Track if we're in the middle of setup

  const startRecording = useCallback(async (triggerSource: 'hotkey' | 'mic' = 'hotkey') => {
    console.log('startRecording called with source:', triggerSource)
    if (recordingRef.current || isSettingUpRef.current) return

    setRecordingSource(triggerSource)
    recordingSourceRef.current = triggerSource
    setTranscriptionError(false)
    transcriptionErrorRef.current = false

    recordingRef.current = true
    isSettingUpRef.current = true
    recordingStartTimeRef.current = Date.now()
    setRecording(true)

    try {
      // Always read the latest settings directly from localStorage
      const savedSettings = localStorage.getItem('overlay-settings')
      const currentSettings = savedSettings ? JSON.parse(savedSettings) : {}
      const currentDevice = currentSettings.inputDevice || 'default'

      console.log('Using device from localStorage:', currentDevice)

      // Use the selected input device from settings
      const audioConstraints: MediaStreamConstraints = {
        audio: currentDevice === 'default' ? true : { deviceId: { exact: currentDevice } }
      }

      streamRef.current = await navigator.mediaDevices.getUserMedia(audioConstraints)

      // Check if recording was canceled during async getUserMedia
      if (!recordingRef.current) {
        console.log('[OverlayWindow] Recording canceled during getUserMedia, cleaning up')
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        isSettingUpRef.current = false
        return
      }
    } catch (error) {
      console.error(
        'Failed to get audio stream with selected device, falling back to default:',
        error
      )

      // Fallback to default device if the selected device is not available
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })

        // Check again if recording was canceled during fallback
        if (!recordingRef.current) {
          console.log('[OverlayWindow] Recording canceled during fallback, cleaning up')
          streamRef.current?.getTracks().forEach((t) => t.stop())
          streamRef.current = null
          isSettingUpRef.current = false
          return
        }
      } catch (fallbackError) {
        console.error('Failed to get any audio stream:', fallbackError)
        recordingRef.current = false
        isSettingUpRef.current = false
        setRecording(false)
        return
      }
    }

    // Final check before setting up audio processing
    if (!recordingRef.current) {
      console.log('[OverlayWindow] Recording canceled before audio setup, cleaning up')
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      isSettingUpRef.current = false
      return
    }

    const audioContext = new AudioContext()
    audioContextRef.current = audioContext
    const source = audioContext.createMediaStreamSource(streamRef.current)
    const analyser = audioContext.createAnalyser()

    analyser.fftSize = 64
    source.connect(analyser)
    analyserRef.current = analyser

    // Check once more if recording was canceled during audio setup
    if (!recordingRef.current) {
      console.log('[OverlayWindow] Recording canceled during audio setup, cleaning up')
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      audioContext.close()
      audioContextRef.current = null
      isSettingUpRef.current = false
      return
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const updateWaveform = (): void => {
      analyser.getByteFrequencyData(dataArray)
      const levels = Array.from(dataArray.slice(0, WAVEFORM_BAR_COUNT)).map((v) => v / 255)
      setAudioLevels(levels)
      animationRef.current = requestAnimationFrame(updateWaveform)
    }
    updateWaveform()

    // Initialize MediaRecorder with a compressed format for fast transcription
    const supportedMimeType = getSupportedMimeType()
    let mediaRecorder: MediaRecorder
    try {
      mediaRecorder = supportedMimeType
        ? new MediaRecorder(streamRef.current, { mimeType: supportedMimeType })
        : new MediaRecorder(streamRef.current)
    } catch (recorderError) {
      console.error('[OverlayWindow] Failed to create MediaRecorder:', recorderError)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      audioContext.close()
      audioContextRef.current = null
      isSettingUpRef.current = false
      recordingRef.current = false
      setRecording(false)
      return
    }

    mediaRecorderRef.current = mediaRecorder
    recorderChunksRef.current = []
    isRecordingCanceledRef.current = false
    onStopResolveRef.current = null

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recorderChunksRef.current.push(e.data)
    }

    mediaRecorder.onerror = (event) => {
      console.error('[OverlayWindow] MediaRecorder error:', event)
      isRecordingCanceledRef.current = true
      // MediaRecorder is stopped automatically on error; stopRecording/cancelRecording will
      // drive cleanup from the button/hotkey path
    }

    mediaRecorder.onstop = () => {
      const blob = isRecordingCanceledRef.current
        ? null
        : new Blob(recorderChunksRef.current, {
            type: mediaRecorder.mimeType || supportedMimeType || 'audio/mp4'
          })
      const resolve = onStopResolveRef.current
      onStopResolveRef.current = null
      recorderChunksRef.current = []
      if (resolve) resolve(blob)
    }

    // Store source for pause/resume
    sourceRef.current = source

    // Connect audio pipeline: source -> analyser
    source.connect(analyser)

    try {
      mediaRecorder.start()
    } catch (startError) {
      console.error('[OverlayWindow] Failed to start MediaRecorder:', startError)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      audioContext.close()
      audioContextRef.current = null
      mediaRecorderRef.current = null
      recorderChunksRef.current = []
      isSettingUpRef.current = false
      recordingRef.current = false
      setRecording(false)
      return
    }

    isSettingUpRef.current = false
    setIsPaused(false)
    console.log('[OverlayWindow] Recording setup complete (MediaRecorder format:', mediaRecorder.mimeType, ')')
  }, []) // No dependencies needed since we read from localStorage

  const togglePause = useCallback(() => {
    if (!recording) return

    if (isPaused) {
      // Resume: reconnect audio processing and recorder
      if (sourceRef.current && analyserRef.current) {
        sourceRef.current.connect(analyserRef.current)
      }
      try {
        mediaRecorderRef.current?.resume()
      } catch (e) {
        console.error('[OverlayWindow] Failed to resume MediaRecorder:', e)
      }
      setIsPaused(false)
      console.log('[OverlayWindow] Recording resumed')
    } else {
      // Pause: disconnect audio processing and pause recorder (but keep stream alive)
      if (sourceRef.current) {
        sourceRef.current.disconnect()
      }
      try {
        mediaRecorderRef.current?.pause()
      } catch (e) {
        console.error('[OverlayWindow] Failed to pause MediaRecorder:', e)
      }
      // Reset audio levels to show paused state
      setAudioLevels(Array(WAVEFORM_BAR_COUNT).fill(0.1))
      setIsPaused(true)
      console.log('[OverlayWindow] Recording paused')
    }
  }, [recording, isPaused])

  async function stopRecording(): Promise<void> {
    if (!recordingRef.current) return

    // Store current recording source before resetting
    const currentRecordingSource = recordingSourceRef.current

    recordingRef.current = false
    isSettingUpRef.current = false
    isRecordingCanceledRef.current = false
    setRecording(false)
    setRecordingSource(null)
    recordingSourceRef.current = null
    setIsPaused(false)
    setTranscriptionError(false)
    transcriptionErrorRef.current = false
    setIsProcessing(true) // Show processing animation

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    const mediaRecorder = mediaRecorderRef.current
    let blob: Blob | null = null
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      blob = await new Promise<Blob | null>((resolve) => {
        onStopResolveRef.current = resolve
        try {
          mediaRecorder.stop()
        } catch (e) {
          console.error('[OverlayWindow] Error stopping MediaRecorder:', e)
        }
      })
    }

    const duration = recordingStartTimeRef.current
      ? (Date.now() - recordingStartTimeRef.current) / 1000
      : 0

    // Stop microphone immediately to prevent it from staying active
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop()
        console.log('[OverlayWindow] Stopped track:', track.kind, track.label)
      })
      streamRef.current = null
    }

    try {
      if (!blob) {
        console.log('[OverlayWindow] Recording canceled or MediaRecorder failed, skipping transcription')
        return
      }

      if (blob.size < 100) {
        console.log('[OverlayWindow] Blob too small, skipping transcription')
        return
      }

      console.log(
        '[OverlayWindow] Recording blob size:',
        blob.size,
        'bytes, type:',
        blob.type,
        'duration:',
        duration,
        's'
      )

      lastRecordingRef.current = { blob, source: currentRecordingSource, duration }
      await processTranscription(currentRecordingSource, blob, duration)
    } catch (err) {
      console.error('[OverlayWindow] stopRecording error:', err)
    } finally {
      setIsProcessing(false) // Hide processing animation
      mediaRecorderRef.current = null
      recorderChunksRef.current = []
      onStopResolveRef.current = null
      isRecordingCanceledRef.current = false
      // Close AudioContext to release audio resources
      if (audioContextRef.current) {
        await audioContextRef.current.close()
        audioContextRef.current = null
        console.log('[OverlayWindow] Closed AudioContext')
      }
    }
  }

  async function cancelRecording(): Promise<void> {
    if (!recordingRef.current && !isSettingUpRef.current) return

    console.log('[OverlayWindow] Canceling recording (quick release)')

    isRecordingCanceledRef.current = true
    recordingRef.current = false
    setRecording(false)
    setRecordingSource(null)
    recordingSourceRef.current = null
    setIsPaused(false)
    setTranscriptionError(false)
    transcriptionErrorRef.current = false

    // Wait briefly for any ongoing setup to detect the cancellation
    // This gives getUserMedia time to complete and clean up
    if (isSettingUpRef.current) {
      console.log('[OverlayWindow] Setup in progress, waiting for cleanup...')
      let waitCount = 0
      while (isSettingUpRef.current && waitCount < 20) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        waitCount++
      }
      console.log('[OverlayWindow] Setup cleanup wait complete')
    }

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        onStopResolveRef.current = () => resolve()
        try {
          mediaRecorder.stop()
        } catch (e) {
          console.error('[OverlayWindow] Error stopping MediaRecorder during cancel:', e)
        }
      })
    }

    // Stop microphone immediately and aggressively for quick releases
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop()
        console.log('[OverlayWindow] Force stopped track:', track.kind, track.label)
      })
      streamRef.current = null
    }

    // Close AudioContext immediately to release audio resources
    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close()
        audioContextRef.current = null
        console.log('[OverlayWindow] Force closed AudioContext')
      } catch (error) {
        console.error('[OverlayWindow] Error closing AudioContext:', error)
      }
    }

    // Reset all references to ensure clean state
    mediaRecorderRef.current = null
    recorderChunksRef.current = []
    onStopResolveRef.current = null
    isRecordingCanceledRef.current = false
    isSettingUpRef.current = false

    // Safety clear any panel transcription destination (in case of quick release)
    await window.bridge.clearPanelTranscriptionDestination()

    console.log('[OverlayWindow] Recording canceled and cleaned up (microphone released)')
  }

  async function processTranscription(
    currentRecordingSource: 'hotkey' | 'mic' | null,
    blob: Blob,
    duration: number
  ): Promise<void> {
    setTranscriptionError(false)
    transcriptionErrorRef.current = false
    setIsProcessing(true)

    try {
      const buf = await blob.arrayBuffer()
      const savedSettings = localStorage.getItem('overlay-settings')
      const currentSettings = savedSettings ? JSON.parse(savedSettings) : {}
      const currentPhraseReplacements = currentSettings.phraseReplacements || []
      const dictionaryWords = currentSettings.dictionaryWords || []

      // Get active smart transcription mode prompt
      const smartTranscriptionModes = currentSettings.smartTranscriptionModes || []
      const activeModeId = currentSettings.activeSmartTranscriptionModeId || 'default'
      const activeMode = smartTranscriptionModes.find((m: { id: string }) => m.id === activeModeId)
      const smartTranscriptionModePrompt = activeMode?.prompt || ''

      const res = await window.bridge.transcribe(blob.type, buf, duration, {
        dictionaryWords,
        smartTranscriptionModePrompt
      })

      // Agent was triggered — it runs in the background, nothing to paste/route
      if (res?.agentMode) return

      const originalText = res?.text || ''

      // Apply phrase replacements to the transcribed text
      const processedText = applyPhraseReplacements(originalText, currentPhraseReplacements)

      console.log('Phrase replacement in paste:', {
        originalText,
        processedText,
        phraseReplacements: currentPhraseReplacements
      })

      // Check for panel transcription destination (hold-to-transcribe feature)
      const panelDestination = await window.bridge.getPanelTranscriptionDestination()

      if (panelDestination) {
        // Route transcription to panel instead of pasting
        const { panel, wasVisible } = panelDestination

        // Check settings to determine if we should create new chat/note
        const settingKey =
          panel === 'chat' ? 'pasteTranscriptionInNewChat' : 'pasteTranscriptionInNewNote'
        const createNew = !wasVisible && (currentSettings[settingKey] ?? true)

        console.log(
          `[OverlayWindow] Routing to ${panel} panel, wasVisible: ${wasVisible}, createNew: ${createNew}`
        )

        if (panel === 'chat') {
          if (createNew) {
            await window.bridge.sendTextToNewChat(processedText)
          } else {
            await window.bridge.sendTextToChatInput(processedText)
          }
        } else {
          // notebook
          if (createNew) {
            await window.bridge.sendTextToNewNote(processedText)
          } else {
            await window.bridge.sendTextToNoteInput(processedText)
          }
        }

        // Clear the destination after sending
        await window.bridge.clearPanelTranscriptionDestination()
      } else if (currentRecordingSource === 'mic') {
        // If recording was triggered by mic button, open TranscriptionPanel
        console.log('[OverlayWindow] Opening TranscriptionPanel with text')
        await window.bridge.sendTranscriptionToPanel(processedText)
      } else {
        // Otherwise, paste the text directly
        await window.bridge.pasteText(processedText)
      }
    } catch (err) {
      console.error('[renderer] transcription/paste failed', err)
      setTranscriptionError(true)
      transcriptionErrorRef.current = true
      setShowButtons(true)
    } finally {
      setIsProcessing(false)
    }
  }

  async function retryTranscription(): Promise<void> {
    const last = lastRecordingRef.current
    if (!last?.blob) return

    setTranscriptionError(false)
    transcriptionErrorRef.current = false
    setShowButtons(true)
    await processTranscription(last.source, last.blob, last.duration)
  }

  useEffect(() => {
    console.log('Setting up event listeners')
    const offStart = window.bridge?.onRecordStart?.(startRecording)
    const offStop = window.bridge?.onRecordStop?.(stopRecording)
    const offCancel = window.bridge?.onRecordCancel?.(cancelRecording)
    return () => {
      console.log('Cleaning up event listeners')
      offStart?.()
      offStop?.()
      offCancel?.()
    }
  }, []) // Only run once on mount

  // Listen for panel closed events (when panel window is closed externally)
  useEffect(() => {
    const offPanelClosed = window.bridge?.onPanelClosed?.((panelType) => {
      // Remove from openPanels set
      setOpenPanels((prev) => {
        const next = new Set(prev)
        next.delete(panelType as 'notebook' | 'chat' | 'browser')
        return next
      })
      if (activePanel === panelType) {
        setActivePanel(null)
      }
    })
    return () => {
      offPanelClosed?.()
    }
  }, [activePanel])

  // Listen for panel visibility changes (from hotkey toggle or other sources)
  // This keeps the overlay UI in sync when panels are hidden/shown via hotkey
  useEffect(() => {
    const offVisibilityChanged = window.bridge?.onPanelVisibilityChanged?.(
      (panelType, isVisible) => {
        console.log(`[OverlayWindow] Visibility changed: ${panelType} -> ${isVisible}`)
        if (!isVisible) {
          // Count a completed session when panel is hidden
          const sessionStat =
            panelType === 'chat'
              ? 'chat_panel_sessions'
              : panelType === 'notebook'
                ? 'notebook_panel_sessions'
                : 'browser_panel_sessions'
          analytics.increment(sessionStat)
        }
        if (isVisible) {
          // Panel is now visible - track it but don't auto-expand
          // User can hover to see open panels
          setOpenPanels((prev) => new Set(prev).add(panelType))
          setActivePanel(panelType)
        } else {
          // Panel is now hidden
          setOpenPanels((prev) => {
            const next = new Set(prev)
            next.delete(panelType)
            return next
          })
          if (activePanel === panelType) {
            setActivePanel(null)
          }
        }
      }
    )
    return () => {
      offVisibilityChanged?.()
    }
  }, [activePanel])

  // Determine dimensions based on state
  // Overlay only expands on hover - panels being open just highlights the buttons when hovered
  const getOverlayDimensions = (): { width: number; height: number } => {
    if (recording) {
      // If recording was triggered by mic button, show full controls
      if (recordingSource === 'mic') {
        return { width: MIC_RECORDING_WIDTH, height: MIC_RECORDING_HEIGHT }
      }
      // If recording via hotkey while panel is open, show waveform only (same as normal recording)
      return { width: RECORDING_WIDTH, height: RECORDING_HEIGHT }
    }
    if (isProcessing) {
      // Processing state: show compact bar with wave animation
      return { width: RECORDING_WIDTH, height: RECORDING_HEIGHT }
    }
    if (transcriptionError) {
      // The retry action is a fifth button, so grow instead of removing the
      // pill's side padding to squeeze it into the normal expanded width.
      return { width: ERROR_WIDTH, height: EXPANDED_HEIGHT }
    }
    if (isHovered) {
      return { width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT }
    }
    return { width: IDLE_WIDTH, height: IDLE_HEIGHT }
  }

  const baseDimensions = getOverlayDimensions()
  const isExpanded = isHovered || transcriptionError
  const isMicRecording = recording && recordingSource === 'mic'
  const pillBorderRadius = recording ? (isMicRecording ? 24 : 14) : isExpanded ? 24 : 10
  const HIT_W = Math.max(EXPANDED_WIDTH, ERROR_WIDTH) + 32
  const HIT_H = EXPANDED_HEIGHT + 16

  return (
    <DockablePanel
      panelType="overlay"
      panelBg="transparent"
      defaultWidth={HIT_W}
      defaultHeight={HIT_H}
      disableResize
      mouseEventBoundary="children"
      defaultPositionPreset="bottom-center"
    >
      <OverlayDockContextBridge
        onDraggingChange={(dragging) => {
          if (dragging && hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current)
            hoverTimeoutRef.current = null
          }
        }}
      >
        {({ startDrag, isDragging, dockedEdge }) => {
          // Stay horizontal while dragging near a side; flip only after dock commits.
          const isVertical =
            !isDragging && (dockedEdge === 'left' || dockedEdge === 'right')
          const width = isVertical ? baseDimensions.height : baseDimensions.width
          const height = isVertical ? baseDimensions.width : baseDimensions.height
          const hitW = isVertical ? HIT_H : HIT_W
          const hitH = isVertical ? HIT_W : HIT_H
          // Top-docked: pin pill under the notch and grow downward on expand.
          // Bottom-docked: pin to bottom of hit box. Side: pin to docked edge.
          const hitJustifyContent =
            dockedEdge === 'top'
              ? 'flex-start'
              : dockedEdge === 'bottom' || !dockedEdge
                ? 'flex-end'
                : 'center'
          const hitAlignItems =
            dockedEdge === 'left'
              ? 'flex-start'
              : dockedEdge === 'right'
                ? 'flex-end'
                : 'center'

          return (
          <div
            data-testid="overlay-pill"
            aria-label="Overlay controls"
            style={{
              width: '100%',
              height: '100%',
              background: 'transparent',
              pointerEvents: 'none',
              overflow: 'visible'
            }}
          >
            <div
              style={{
                width: hitW,
                height: hitH,
                display: 'flex',
                flexDirection: isVertical ? 'row' : 'column',
                alignItems: isVertical ? hitJustifyContent : hitAlignItems,
                justifyContent: isVertical ? hitAlignItems : hitJustifyContent,
                background: 'transparent',
                pointerEvents: 'none'
              }}
            >
              {/* Agent toast — appears above/beside control bar when agent is active */}
              {agentStatus && (
                <div
                  style={{
                    position: 'absolute',
                    ...(isVertical
                      ? {
                          [dockedEdge === 'right' ? 'right' : 'left']:
                            EXPANDED_HEIGHT + 16 + 8,
                          top: '50%',
                          transform: 'translateY(-50%)'
                        }
                      : dockedEdge === 'top'
                        ? {
                            top: EXPANDED_HEIGHT + 16 + 8,
                            left: '50%',
                            transform: 'translateX(-50%)'
                          }
                        : {
                            bottom: EXPANDED_HEIGHT + 16 + 8,
                            left: '50%',
                            transform: 'translateX(-50%)'
                          }),
                    background:
                      agentStatus === 'error' ? 'rgba(220,38,38,0.92)' : 'rgba(19,19,19,0.92)',
                    border: `1px solid ${
                      agentStatus === 'done'
                        ? 'rgba(34,197,94,0.5)'
                        : agentStatus === 'error'
                          ? 'rgba(220,38,38,0.3)'
                          : 'rgba(255,255,255,0.12)'
                    }`,
                    borderRadius: 12,
                    padding: '6px 14px',
                    backdropFilter: 'blur(20px)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    maxWidth: 300,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    pointerEvents: 'none',
                    zIndex: 9999
                  }}
                >
                  {agentStatus === 'thinking' && (
                    <span style={{ fontSize: 12, opacity: 0.6, animation: 'pulse 1.4s infinite' }}>
                      ●
                    </span>
                  )}
                  {agentStatus === 'done' && (
                    <span style={{ fontSize: 11, color: '#22c55e' }}>✓</span>
                  )}
                  {agentStatus === 'error' && <span style={{ fontSize: 11 }}>✕</span>}
                  <span
                    style={{
                      fontSize: 12,
                      color: 'rgba(255,255,255,0.9)',
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      letterSpacing: '-0.01em'
                    }}
                  >
                    {agentStatus === 'thinking'
                      ? 'Working…'
                      : agentSummary || (agentStatus === 'error' ? 'Agent error' : 'Done')}
                  </span>
                </div>
              )}

              {/* Agent state border — racing white when thinking, green/red on result */}
              <div
                onMouseEnter={handleWidgetMouseEnter}
                onMouseMove={handleWidgetMouseMove}
                onMouseLeave={() => handleWidgetMouseLeave(isDragging)}
                onMouseDown={(e) => {
                  const target = e.target as HTMLElement
                  if (target.closest('button, input')) return
                  startDrag(e)
                }}
                style={{
                  position: 'relative',
                  pointerEvents: 'auto',
                  cursor: 'default'
                }}
              >
                {agentStatus === 'thinking' && (
                  <div
                    className="agent-border-spin"
                    style={
                      {
                        position: 'absolute',
                        inset: -2,
                        borderRadius: pillBorderRadius + 2,
                        zIndex: 0,
                        pointerEvents: 'none'
                      } as React.CSSProperties
                    }
                  />
                )}
                {(agentStatus === 'done' || agentStatus === 'error') && (
                  <div
                    style={
                      {
                        position: 'absolute',
                        inset: -2,
                        borderRadius: pillBorderRadius + 2,
                        boxShadow:
                          agentStatus === 'done'
                            ? '0 0 0 2px #22c55e, 0 0 16px rgba(34,197,94,0.5)'
                            : '0 0 0 2px #ef4444, 0 0 16px rgba(239,68,68,0.5)',
                        zIndex: 0,
                        pointerEvents: 'none'
                      } as React.CSSProperties
                    }
                  />
                )}
                {/* Control bar — always draggable; buttons have no-drag so they stay clickable */}
                <div
                  style={
                    {
                      width,
                      height,
                      borderRadius: pillBorderRadius,
                      background:
                        recording || isExpanded
                          ? 'rgba(19, 19, 19, 0.95)'
                          : 'rgba(19, 19, 19, 0.8)',
                      border:
                        recording || isExpanded
                          ? '1px solid rgba(255, 255, 255, 0.15)'
                          : '1px solid rgba(255, 255, 255, 0.3)',
                      backdropFilter: 'blur(20px)',
                      display: 'flex',
                      flexDirection: isVertical ? 'column' : 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: recording
                        ? isMicRecording
                          ? 10
                          : WAVEFORM_GAP
                        : isExpanded
                          ? transcriptionError
                            ? 4
                            : 6
                          : WAVEFORM_GAP,
                      padding: recording
                        ? isVertical
                          ? '6px 0'
                          : '0 6px'
                        : isExpanded
                          ? isVertical
                            ? '8px 0'
                            : '0 8px'
                          : 0,
                      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: 'none',
                      position: 'relative',
                      zIndex: 1,
                      // Always draggable — buttons override with no-drag for click handling
                      cursor: 'default'
                    } as React.CSSProperties
                  }
                >
                  {recording ? (
                    isMicRecording ? (
                      // Mic recording mode: Stop button + Waveform + Pause/Play button
                      <>
                        {/* Stop button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            stopRecording()
                          }}
                          style={
                            {
                              width: 36,
                              height: 36,
                              borderRadius: '50%',
                              background: '#dc2626',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'default',
                              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                              padding: 0,
                              pointerEvents: 'auto',
                              animation: 'fadeScaleIn 0.15s ease-out'
                            } as React.CSSProperties
                          }
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#ef4444'
                            e.currentTarget.style.transform = 'scale(1.08)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#dc2626'
                            e.currentTarget.style.transform = 'scale(1)'
                          }}
                        >
                          <Square size={12} color="#fff" fill="#fff" />
                        </button>

                        {/* Waveform */}
                        <WaveformBars levels={audioLevels} isVertical={isVertical} />

                        {/* Pause/Play button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePause()
                          }}
                          title={isPaused ? 'Resume recording' : 'Pause recording'}
                          style={
                            {
                              width: 36,
                              height: 36,
                              borderRadius: '50%',
                              background: 'rgba(255, 255, 255, 0.08)',
                              border: '1px solid rgba(255, 255, 255, 0.12)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'default',
                              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                              padding: 0,
                              pointerEvents: 'auto',
                              animation: 'fadeScaleIn 0.15s ease-out'
                            } as React.CSSProperties
                          }
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)'
                            e.currentTarget.style.transform = 'scale(1.08)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
                            e.currentTarget.style.transform = 'scale(1)'
                          }}
                        >
                          {isPaused ? (
                            <Play size={15} color="rgba(255,255,255,0.7)" strokeWidth={1.75} />
                          ) : (
                            <Pause size={15} color="rgba(255,255,255,0.7)" strokeWidth={1.75} />
                          )}
                        </button>
                      </>
                    ) : (
                      // Simple waveform for non-expanded recording
                      <WaveformBars levels={audioLevels} isVertical={isVertical} />
                    )
                  ) : isProcessing ? (
                    // Processing state: waveform bars with bouncing wave animation
                    <WaveformBars isVertical={isVertical} bouncing />
                  ) : isExpanded && showButtons ? (
                    // Expanded state with action buttons (shown after expansion animation)
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePanel('notebook')
                        }}
                        style={
                          {
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: openPanels.has('notebook')
                              ? 'rgba(255, 255, 255, 0.25)'
                              : 'rgba(255, 255, 255, 0.08)',
                            border: openPanels.has('notebook')
                              ? '1px solid rgba(255, 255, 255, 0.4)'
                              : '1px solid rgba(255, 255, 255, 0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'default',
                            transition:
                              'background 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            padding: 0,
                            pointerEvents: 'auto',
                            animation: 'buttonFadeIn 0.12s ease-out forwards',
                            animationDelay: '180ms',
                            opacity: 0
                          } as React.CSSProperties
                        }
                        onMouseEnter={(e) => {
                          if (!openPanels.has('notebook')) {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)'
                          }
                          e.currentTarget.style.transform = 'scale(1.08)'
                        }}
                        onMouseLeave={(e) => {
                          if (!openPanels.has('notebook')) {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
                          }
                          e.currentTarget.style.transform = 'scale(1)'
                        }}
                      >
                        <Notebook
                          size={15}
                          color={openPanels.has('notebook') ? '#fff' : 'rgba(255,255,255,0.7)'}
                          strokeWidth={1.75}
                        />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          startRecording('mic')
                        }}
                        style={
                          {
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'default',
                            transition:
                              'background 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            padding: 0,
                            pointerEvents: 'auto',
                            animation: 'buttonFadeIn 0.12s ease-out forwards',
                            animationDelay: '200ms',
                            opacity: 0
                          } as React.CSSProperties
                        }
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'
                          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)'
                          e.currentTarget.style.transform = 'scale(1.08)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
                          e.currentTarget.style.transform = 'scale(1)'
                        }}
                      >
                        <Mic size={15} color="rgba(255,255,255,0.7)" strokeWidth={1.75} />
                      </button>
                      {transcriptionError && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            retryTranscription()
                          }}
                          title="Retry transcription"
                          style={
                            {
                              width: 32,
                              height: 32,
                              borderRadius: '50%',
                              background: 'rgba(239, 68, 68, 0.12)',
                              border: '1px solid rgba(239, 68, 68, 0.5)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'default',
                              transition:
                                'background 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                              padding: 0,
                              pointerEvents: 'auto',
                              animation: 'buttonFadeIn 0.12s ease-out forwards',
                              animationDelay: '200ms',
                              opacity: 0
                            } as React.CSSProperties
                          }
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'
                            e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.7)'
                            e.currentTarget.style.transform = 'scale(1.08)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)'
                            e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)'
                            e.currentTarget.style.transform = 'scale(1)'
                          }}
                        >
                          <RefreshCw size={15} color="#ef4444" strokeWidth={1.75} />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePanel('chat')
                        }}
                        style={
                          {
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: openPanels.has('chat')
                              ? 'rgba(255, 255, 255, 0.25)'
                              : 'rgba(255, 255, 255, 0.08)',
                            border: openPanels.has('chat')
                              ? '1px solid rgba(255, 255, 255, 0.4)'
                              : '1px solid rgba(255, 255, 255, 0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'default',
                            transition:
                              'background 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            padding: 0,
                            pointerEvents: 'auto',
                            animation: 'buttonFadeIn 0.12s ease-out forwards',
                            animationDelay: '220ms',
                            opacity: 0
                          } as React.CSSProperties
                        }
                        onMouseEnter={(e) => {
                          if (!openPanels.has('chat')) {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)'
                          }
                          e.currentTarget.style.transform = 'scale(1.08)'
                        }}
                        onMouseLeave={(e) => {
                          if (!openPanels.has('chat')) {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
                          }
                          e.currentTarget.style.transform = 'scale(1)'
                        }}
                      >
                        <MessageCircle
                          size={15}
                          color={openPanels.has('chat') ? '#fff' : 'rgba(255,255,255,0.7)'}
                          strokeWidth={1.75}
                        />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePanel('browser')
                        }}
                        style={
                          {
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: openPanels.has('browser')
                              ? 'rgba(255, 255, 255, 0.25)'
                              : 'rgba(255, 255, 255, 0.08)',
                            border: openPanels.has('browser')
                              ? '1px solid rgba(255, 255, 255, 0.4)'
                              : '1px solid rgba(255, 255, 255, 0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'default',
                            transition:
                              'background 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            padding: 0,
                            pointerEvents: 'auto',
                            animation: 'buttonFadeIn 0.12s ease-out forwards',
                            animationDelay: '240ms',
                            opacity: 0
                          } as React.CSSProperties
                        }
                        onMouseEnter={(e) => {
                          if (!openPanels.has('browser')) {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)'
                          }
                          e.currentTarget.style.transform = 'scale(1.08)'
                        }}
                        onMouseLeave={(e) => {
                          if (!openPanels.has('browser')) {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
                          }
                          e.currentTarget.style.transform = 'scale(1)'
                        }}
                      >
                        <Globe
                          size={15}
                          color={openPanels.has('browser') ? '#fff' : 'rgba(255,255,255,0.7)'}
                          strokeWidth={1.75}
                        />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            {/* CSS for animations */}
            <style>{`
        @property --agent-angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes agentBorderSpin {
          to { --agent-angle: 360deg; }
        }
        .agent-border-spin {
          background: conic-gradient(
            from var(--agent-angle),
            transparent 0deg,
            rgba(255, 255, 255, 0.85) 50deg,
            transparent 100deg
          );
          animation: agentBorderSpin 1.2s linear infinite;
        }
        @keyframes fadeScaleIn {
          from {
            opacity: 0;
            transform: scale(0.8);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes buttonFadeIn {
          from {
            opacity: 0;
            transform: scale(0.85);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes waveBounce {
          0%, 100% {
            height: 2px;
          }
          25% {
            height: 15px;
          }
          50% {
            height: 2px;
          }
          75% {
            height: 15px;
          }
        }
        @keyframes waveBounceVertical {
          0%, 100% {
            width: 2px;
          }
          25% {
            width: 15px;
          }
          50% {
            width: 2px;
          }
          75% {
            width: 15px;
          }
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
          </div>
          )
        }}
      </OverlayDockContextBridge>
    </DockablePanel>
  )
}
