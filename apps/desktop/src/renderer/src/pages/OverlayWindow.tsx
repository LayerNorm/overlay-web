import { useEffect, useRef, useState, useCallback, ReactElement } from 'react'
import { Notebook, Mic, MessageCircle, Square, Pause, Play, Globe, RefreshCw } from 'lucide-react'
import DockablePanel from '../components/DockablePanel'
import { useDockableDrag } from '../components/DockablePanelContext'
import { analytics } from '../services/analytics'
import { WarmMicrophoneSession } from '../services/warm-microphone-session'
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
}): ReactElement<any> {
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

function getConfiguredInputDevice(): string {
  try {
    const savedSettings = localStorage.getItem('overlay-settings')
    if (!savedSettings) return 'default'
    const inputDevice = (JSON.parse(savedSettings) as { inputDevice?: unknown }).inputDevice
    return typeof inputDevice === 'string' && inputDevice ? inputDevice : 'default'
  } catch {
    return 'default'
  }
}

function getKeepMicrophoneWarm(): boolean {
  try {
    const savedSettings = localStorage.getItem('overlay-settings')
    if (!savedSettings) return false
    return (
      (JSON.parse(savedSettings) as { keepMicrophoneWarm?: unknown }).keepMicrophoneWarm === true
    )
  } catch {
    return false
  }
}

interface OverlayDockContextBridgeProps {
  children: (ctx: ReturnType<typeof useDockableDrag>) => ReactElement<any>
  onDraggingChange: (isDragging: boolean) => void
}

interface PendingTranscriptionDelivery {
  text: string
  source: 'hotkey' | 'mic' | null
  pasteInNewChatWhenHidden: boolean
  pasteInNewNoteWhenHidden: boolean
}

function OverlayDockContextBridge({
  children,
  onDraggingChange
}: OverlayDockContextBridgeProps): ReactElement<any> {
  const ctx = useDockableDrag()

  useEffect(() => {
    onDraggingChange(ctx.isDragging)
  }, [ctx.isDragging, onDraggingChange])

  return children(ctx)
}

export function OverlayWindow(): ReactElement<any> {
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
  const pendingDeliveryRef = useRef<PendingTranscriptionDelivery | null>(null)
  const panelInteractionGenerationRef = useRef(0)
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
    panelInteractionGenerationRef.current += 1
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
  const inputDeviceRef = useRef(getConfiguredInputDevice())
  const keepMicrophoneWarmRef = useRef(getKeepMicrophoneWarm())
  const microphoneSessionRef = useRef<WarmMicrophoneSession | null>(null)
  if (!microphoneSessionRef.current) {
    microphoneSessionRef.current = new WarmMicrophoneSession((constraints) =>
      navigator.mediaDevices.getUserMedia(constraints)
    )
  }

  const parkOrReleaseMicrophone = useCallback((context: string): void => {
    const microphoneSession = microphoneSessionRef.current
    if (keepMicrophoneWarmRef.current) {
      void microphoneSession?.warm(inputDeviceRef.current).catch((error) => {
        console.warn(`[OverlayWindow] Failed to keep microphone warm after ${context}:`, error)
      })
    } else {
      microphoneSession?.deactivate()
      microphoneSession?.dispose()
    }
    streamRef.current = null
  }, [])

  useEffect(() => {
    const microphoneSession = microphoneSessionRef.current
    if (!microphoneSession) return

    let disposed = false
    let permissionPoll: ReturnType<typeof setInterval> | null = null

    const stopPermissionPoll = (): void => {
      if (!permissionPoll) return
      clearInterval(permissionPoll)
      permissionPoll = null
    }

    const warmWhenPermitted = async (): Promise<void> => {
      if (disposed || !keepMicrophoneWarmRef.current) return
      try {
        const permission = await window.bridge.checkMicrophonePermission()
        if (disposed || !keepMicrophoneWarmRef.current || permission !== 'granted') return
        await microphoneSession.warm(inputDeviceRef.current)
        stopPermissionPoll()
        console.log('[OverlayWindow] Microphone prewarmed for immediate recording')
      } catch (error) {
        if (!disposed) {
          console.warn('[OverlayWindow] Microphone prewarm deferred:', error)
        }
      }
    }

    const ensureMicrophoneWarm = (): void => {
      if (disposed || !keepMicrophoneWarmRef.current) return
      void warmWhenPermitted()
      if (!permissionPoll) {
        permissionPoll = setInterval(() => void warmWhenPermitted(), 1000)
      }
    }

    ensureMicrophoneWarm()
    const offSettingsChanged = window.bridge.onSettingsChanged(({ key, value }) => {
      if (key === 'inputDevice' && typeof value === 'string') {
        inputDeviceRef.current = value
        if (recordingRef.current) return
        if (keepMicrophoneWarmRef.current) {
          ensureMicrophoneWarm()
        } else {
          microphoneSession.dispose()
        }
        return
      }
      if (key !== 'keepMicrophoneWarm' || typeof value !== 'boolean') return
      keepMicrophoneWarmRef.current = value
      if (recordingRef.current) return
      if (value) {
        ensureMicrophoneWarm()
      } else {
        stopPermissionPoll()
        microphoneSession.dispose()
        console.log('[OverlayWindow] Warm microphone disabled; input stream released')
      }
    })

    return () => {
      disposed = true
      stopPermissionPoll()
      offSettingsChanged?.()
      microphoneSession.dispose()
    }
  }, [])

  const startRecording = useCallback(async (triggerSource: 'hotkey' | 'mic' = 'hotkey') => {
    console.log('startRecording called with source:', triggerSource)
    if (recordingRef.current || isSettingUpRef.current) return

    setRecordingSource(triggerSource)
    recordingSourceRef.current = triggerSource
    setTranscriptionError(false)
    transcriptionErrorRef.current = false

    recordingRef.current = true
    isSettingUpRef.current = true
    recordingStartTimeRef.current = null
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    analyserRef.current = null
    setAudioLevels(Array(WAVEFORM_BAR_COUNT).fill(0))
    setRecording(true)

    try {
      const currentDevice = inputDeviceRef.current
      const activationStartedAt = performance.now()
      console.log('Using configured input device:', currentDevice)
      streamRef.current = await microphoneSessionRef.current!.activate(currentDevice)
      console.log(
        '[OverlayWindow] Microphone activation latency:',
        `${Math.round(performance.now() - activationStartedAt)}ms`
      )
    } catch (error) {
      console.error('Failed to activate microphone stream:', error)
      recordingRef.current = false
      isSettingUpRef.current = false
      setRecording(false)
      return
    }

    // The user may have released/cancelled while a cold first-time warmup was
    // still resolving. Keep the stream warm, but do not start a recorder.
    if (!recordingRef.current) {
      console.log('[OverlayWindow] Recording canceled before audio setup, cleaning up')
      parkOrReleaseMicrophone('canceled setup')
      isSettingUpRef.current = false
      return
    }

    // Start the recorder before constructing the visual analyser. Audio capture
    // must never wait for waveform setup.
    const supportedMimeType = getSupportedMimeType()
    let mediaRecorder: MediaRecorder
    try {
      mediaRecorder = supportedMimeType
        ? new MediaRecorder(streamRef.current, { mimeType: supportedMimeType })
        : new MediaRecorder(streamRef.current)
    } catch (recorderError) {
      console.error('[OverlayWindow] Failed to create MediaRecorder:', recorderError)
      parkOrReleaseMicrophone('recorder creation failure')
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

    try {
      recordingStartTimeRef.current = Date.now()
      mediaRecorder.start()
      console.log('[OverlayWindow] MediaRecorder capturing')
    } catch (startError) {
      console.error('[OverlayWindow] Failed to start MediaRecorder:', startError)
      parkOrReleaseMicrophone('recorder start failure')
      mediaRecorderRef.current = null
      recorderChunksRef.current = []
      isSettingUpRef.current = false
      recordingRef.current = false
      setRecording(false)
      return
    }

    if (!recordingRef.current) {
      isSettingUpRef.current = false
      return
    }

    try {
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      if (audioContext.state === 'suspended') {
        void audioContext.resume().catch((error) => {
          console.warn('[OverlayWindow] Audio analyser resume deferred:', error)
        })
      }
      const source = audioContext.createMediaStreamSource(streamRef.current)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 64
      source.connect(analyser)
      sourceRef.current = source
      analyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const updateWaveform = (): void => {
        analyser.getByteFrequencyData(dataArray)
        const levels = Array.from(dataArray.slice(0, WAVEFORM_BAR_COUNT)).map((v) => v / 255)
        setAudioLevels(levels)
        animationRef.current = requestAnimationFrame(updateWaveform)
      }
      updateWaveform()
    } catch (waveformError) {
      console.warn('[OverlayWindow] Waveform unavailable; audio recording continues:', waveformError)
    }

    isSettingUpRef.current = false
    setIsPaused(false)
    console.log('[OverlayWindow] Recording setup complete (MediaRecorder format:', mediaRecorder.mimeType, ')')
  }, [parkOrReleaseMicrophone])

  const togglePause = useCallback(() => {
    if (!recording) return

    if (isPaused) {
      // Resume: reconnect audio processing and recorder
      if (sourceRef.current && analyserRef.current) {
        sourceRef.current.connect(analyserRef.current)
      }
      try {
        mediaRecorderRef.current?.resume()
        microphoneSessionRef.current?.setCaptureEnabled(true)
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
        microphoneSessionRef.current?.setCaptureEnabled(false)
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
    analyserRef.current = null
    setAudioLevels(Array(WAVEFORM_BAR_COUNT).fill(0))

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

    parkOrReleaseMicrophone('recording')

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
    analyserRef.current = null
    setAudioLevels(Array(WAVEFORM_BAR_COUNT).fill(0))

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

    parkOrReleaseMicrophone('cancellation')

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

    console.log('[OverlayWindow] Recording canceled and microphone lifecycle restored')
  }

  async function deliverTranscription(delivery: PendingTranscriptionDelivery): Promise<void> {
    const panelDestination = await window.bridge.getPanelTranscriptionDestination()

    if (panelDestination) {
      const { panel, wasVisible } = panelDestination
      const createNew =
        !wasVisible &&
        (panel === 'chat'
          ? delivery.pasteInNewChatWhenHidden
          : delivery.pasteInNewNoteWhenHidden)

      console.log(
        `[OverlayWindow] Routing to ${panel} panel, wasVisible: ${wasVisible}, createNew: ${createNew}`
      )

      if (panel === 'chat') {
        if (createNew) {
          await window.bridge.sendTextToNewChat(delivery.text)
        } else {
          await window.bridge.sendTextToChatInput(delivery.text)
        }
      } else if (createNew) {
        await window.bridge.sendTextToNewNote(delivery.text)
      } else {
        await window.bridge.sendTextToNoteInput(delivery.text)
      }

      await window.bridge.clearPanelTranscriptionDestination()
      return
    }

    if (delivery.source === 'mic') {
      console.log('[OverlayWindow] Opening TranscriptionPanel with text')
      await window.bridge.sendTranscriptionToPanel(delivery.text)
      return
    }

    const pasted = await window.bridge.pasteText(delivery.text)
    if (!pasted) throw new Error('transcription_paste_rejected')
  }

  async function processTranscription(
    currentRecordingSource: 'hotkey' | 'mic' | null,
    blob: Blob,
    duration: number
  ): Promise<void> {
    setTranscriptionError(false)
    transcriptionErrorRef.current = false
    setIsProcessing(true)
    pendingDeliveryRef.current = null

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

      const delivery: PendingTranscriptionDelivery = {
        text: processedText,
        source: currentRecordingSource,
        pasteInNewChatWhenHidden: currentSettings.pasteTranscriptionInNewChat !== false,
        pasteInNewNoteWhenHidden: currentSettings.pasteTranscriptionInNewNote !== false
      }
      pendingDeliveryRef.current = delivery

      try {
        await deliverTranscription(delivery)
        pendingDeliveryRef.current = null
      } catch (deliveryError) {
        console.error('[renderer] transcription succeeded but delivery failed', deliveryError)
        setTranscriptionError(true)
        transcriptionErrorRef.current = true
        setShowButtons(true)
      }
    } catch (err) {
      console.error('[renderer] transcription failed', err)
      setTranscriptionError(true)
      transcriptionErrorRef.current = true
      setShowButtons(true)
    } finally {
      setIsProcessing(false)
    }
  }

  async function retryTranscription(): Promise<void> {
    const pendingDelivery = pendingDeliveryRef.current
    if (pendingDelivery) {
      setTranscriptionError(false)
      transcriptionErrorRef.current = false
      setShowButtons(true)
      setIsProcessing(true)
      try {
        await deliverTranscription(pendingDelivery)
        pendingDeliveryRef.current = null
      } catch (deliveryError) {
        console.error('[renderer] transcription redelivery failed', deliveryError)
        setTranscriptionError(true)
        transcriptionErrorRef.current = true
      } finally {
        setIsProcessing(false)
      }
      return
    }

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
      panelInteractionGenerationRef.current += 1
      // Remove from openPanels set
      setOpenPanels((prev) => {
        const next = new Set(prev)
        next.delete(panelType as 'notebook' | 'chat' | 'browser')
        return next
      })
      setActivePanel((current) => (current === panelType ? null : current))
    })
    return () => {
      offPanelClosed?.()
    }
  }, [])

  // Listen for panel visibility changes (from hotkey toggle or other sources)
  // This keeps the overlay UI in sync when panels are hidden/shown via hotkey
  useEffect(() => {
    const offVisibilityChanged = window.bridge?.onPanelVisibilityChanged?.(
      (panelType, isVisible) => {
        panelInteractionGenerationRef.current += 1
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
          setActivePanel((current) => (current === panelType ? null : current))
        }
      }
    )
    return () => {
      offVisibilityChanged?.()
    }
  }, [])

  useEffect(() => {
    let disposed = false
    const synchronizePanelVisibility = async (): Promise<void> => {
      const generation = panelInteractionGenerationRef.current
      try {
        const panelTypes = ['notebook', 'chat', 'browser'] as const
        const visibility: Array<{ panel: (typeof panelTypes)[number]; isVisible: boolean }> = []
        for (const panel of panelTypes) {
          visibility.push({ panel, isVisible: (await window.bridge.isPanelVisible(panel)).isVisible })
        }
        if (disposed || generation !== panelInteractionGenerationRef.current) return
        const visiblePanels = visibility.filter((entry) => entry.isVisible).map((entry) => entry.panel)
        setOpenPanels(new Set(visiblePanels))
        setActivePanel((current) => {
          if (current && visiblePanels.includes(current)) return current
          return visiblePanels.at(-1) ?? null
        })
      } catch (error) {
        console.warn('[OverlayWindow] Failed to synchronize panel visibility:', error)
      }
    }

    void synchronizePanelVisibility()
    return () => {
      disposed = true
    }
  }, [])

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
                        (<>
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
                        </>)
                      ) : (
                        // Simple waveform for non-expanded recording
                        (<WaveformBars levels={audioLevels} isVertical={isVertical} />)
                      )
                    ) : isProcessing ? (
                      // Processing state: waveform bars with bouncing wave animation
                      (<WaveformBars isVertical={isVertical} bouncing />)
                    ) : isExpanded && showButtons ? (
                      // Expanded state with action buttons (shown after expansion animation)
                      (<>
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
                            title="Retry"
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
                      </>)
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
          );
        }}
      </OverlayDockContextBridge>
    </DockablePanel>
  );
}
