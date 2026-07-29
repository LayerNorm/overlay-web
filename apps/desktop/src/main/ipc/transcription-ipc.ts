import { app, shell } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'
import { join } from 'path'
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { settingsService } from '../services/settings-service'
import { whisperKitService } from '../services/whisperkit-service'
import { parakeetService } from '../services/parakeet-service'
import { enhanceTranscription } from '../services/llm-enhancer'
import { windowManager } from '../services/window-manager'
import { systemUtils } from '../services/system-utils'
import { keyCacheService } from '../services/key-cache-service'
import { safeStorageService } from '../services/security/safe-storage-service'
import { serverProfileService } from '../services/security/server-profile-service'
import { subscriptionService } from '../services/subscription-service'
import {
  createTranscriptionIdempotencyKey,
  createTranscriptionRequestHeaders,
  encodeTranscriptionMultipart
} from '../services/transcription-request'

const getLocalService = (modelId: string): typeof parakeetService | typeof whisperKitService => {
  if (modelId.startsWith('parakeet_')) {
    return parakeetService
  }
  return whisperKitService
}

const saveTranscriptionToHistory = (
  text: string,
  wordsIn: number,
  wordsOut: number,
  duration: number
): void => {
  const mainWindow = windowManager.findWindowByType('main')
  if (mainWindow) {
    mainWindow.webContents.send('transcription:add', {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text,
      timestamp: Date.now(),
      wordsIn,
      wordsOut,
      duration
    })
  }
}

const WAKE_WORD_RE = /^overlay[,.]?\s+/i

const getRecordingsDir = (): string => join(app.getPath('userData'), 'recordings')

const RETENTION_MS: Record<'24h' | '7d' | '30d', number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
}

function cleanupRecordings(): void {
  try {
    const recordingsDir = getRecordingsDir()
    if (!existsSync(recordingsDir)) return

    const retention = settingsService.recordingStorageRetention || '7d'
    const retentionMs = RETENTION_MS[retention] || RETENTION_MS['7d']
    const now = Date.now()

    for (const entry of readdirSync(recordingsDir)) {
      const fullPath = join(recordingsDir, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isFile() && now - stat.mtimeMs > retentionMs) {
          rmSync(fullPath)
          console.log('[Recording] Removed old recording:', fullPath)
        }
      } catch (err) {
        console.error('[Recording] Failed to remove old recording:', fullPath, err)
      }
    }
  } catch (err) {
    console.error('[Recording] Failed to cleanup recordings:', err)
  }
}

async function classifyIntent(text: string): Promise<'TASK' | 'GENERATE'> {
  try {
    const groqApiKey = await keyCacheService.getKey('groq')
    if (!groqApiKey) return 'GENERATE'
    const Groq = (await import('groq-sdk')).default
    const groq = new Groq({ apiKey: groqApiKey })
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content:
            'Classify the input as TASK (an action: schedule, open, search, send, create, play, find, add) or GENERATE (text editing/writing: rewrite, fix, improve, summarize, translate). Respond with exactly one word: TASK or GENERATE.'
        },
        { role: 'user', content: text }
      ],
      max_tokens: 5,
      temperature: 0
    })
    const result = response.choices[0]?.message?.content?.trim().toUpperCase()
    return result === 'TASK' ? 'TASK' : 'GENERATE'
  } catch (err) {
    console.error('[Intent] Classification failed, defaulting to GENERATE:', err)
    return 'GENERATE'
  }
}

export function registerTranscriptionIPC(): void {
  // Screenshot capture handler for multi-monitor support
  ipcMain.handle('capture-screenshots', async () => {
    return systemUtils.captureScreenshots()
  })

  // Transcription handler
  ipcMain.handle(
    'stt:transcribe',
    async (
      _evt,
      {
        mime,
        buf,
        duration,
        dictionaryWords = [],
        smartTranscriptionModePrompt
      }: {
        mime: string
        buf: ArrayBuffer
        duration: number
        dictionaryWords?: string[]
        smartTranscriptionModePrompt?: string
      }
    ) => {
      const dir = mkdtempSync(join(tmpdir(), 'stt-'))
      const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'm4a' : 'wav'
      const file = join(dir, `audio.${ext}`)
      writeFileSync(file, Buffer.from(buf))

      const requestTimeoutMs = Math.min(300000, Math.max(60000, duration * 1000 * 2 + 10000))

      const saveRecording = (): void => {
        if (!settingsService.recordingStorageEnabled) return
        try {
          const recordingsDir = getRecordingsDir()
          mkdirSync(recordingsDir, { recursive: true })
          const recordingPath = join(recordingsDir, `recording-${Date.now()}.${ext}`)
          copyFileSync(file, recordingPath)
          console.log('[Recording] Saved recording:', recordingPath)
        } catch (err) {
          console.error('[Recording] Failed to save recording:', err)
        }
      }

      const saveRecoveryRecording = (): void => {
        // Normal recording storage already preserves every attempt. When it is
        // disabled, retain only failed audio so an important dictation can be
        // recovered from the existing "Open recordings folder" control.
        if (settingsService.recordingStorageEnabled) return
        try {
          const recordingsDir = getRecordingsDir()
          mkdirSync(recordingsDir, { recursive: true })
          const recoveryPath = join(recordingsDir, `failed-recording-${Date.now()}.${ext}`)
          copyFileSync(file, recoveryPath)
          console.warn('[Recording] Preserved failed recording for recovery:', recoveryPath)
        } catch (err) {
          console.error('[Recording] Failed to preserve failed recording:', err)
        }
      }

      // Cleanup function to delete temporary audio files
      const cleanupTempFiles = (): void => {
        try {
          rmSync(dir, { recursive: true, force: true })
          console.log(`[Main] Cleaned up temporary audio files: ${dir}`)
        } catch (cleanupError) {
          console.warn(`[Main] Failed to cleanup temp files at ${dir}:`, cleanupError)
        }
      }

      try {
        const fs = await import('fs')
        const primaryLocalModel = settingsService.selectedModelId || 'parakeet_v2'
        const primaryService = getLocalService(primaryLocalModel)
        const baseAvailable = whisperKitService.isAvailable()
        const canUseLocal =
          settingsService.localTranscriptionEnabled &&
          (primaryService.isAvailable() || baseAvailable)
        let transcriptionText = ''
        const prompt =
          dictionaryWords && dictionaryWords.length > 0
            ? `Please spell these words exactly as written: ${dictionaryWords.join(', ')}.`
            : undefined

        const waitForModelReady = async (modelId: string, timeoutMs?: number): Promise<boolean> => {
          const service = getLocalService(modelId)
          if (!service.isAvailable()) {
            return false
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (service.isServerReady(modelId as any)) {
            return true
          }

          const startPromise = service
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .startServerForModel(modelId as any)
            .then(() => true)
            .catch((error) => {
              console.error(`[Main] Failed to start server for ${modelId}:`, error)
              return false
            })

          if (timeoutMs === undefined) {
            return startPromise
          }

          const ready = await Promise.race<boolean>([
            startPromise,
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs))
          ])

          if (!ready) {
            console.log(
              `[Main] ${modelId} server not ready within ${timeoutMs}ms, proceeding to fallback if available`
            )
          }

          return ready
        }

        const transcribeWithLocal = async (
          modelId: string,
          waitTimeoutMs?: number
        ): Promise<string | null> => {
          const service = getLocalService(modelId)
          try {
            const ready = await waitForModelReady(modelId, waitTimeoutMs)
            if (!ready) {
              return null
            }

            const result = await service.transcribe(
              file,
              {
                temperature: 0,
                prompt,
                timeout: requestTimeoutMs
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              modelId as any
            )
            console.log(`[Main] Local transcription successful using ${modelId}`)
            return result.text
          } catch (error) {
            console.error(`[Main] Local transcription failed for ${modelId}:`, error)
            return null
          }
        }

        const transcribeWithGroqDirect = async (): Promise<string | null> => {
          const groqApiKey = await keyCacheService.getKey('groq')
          if (!groqApiKey) {
            console.log('[Main] No Groq API key available for direct transcription')
            return null
          }
          const Groq = (await import('groq-sdk')).default
          const groq = new Groq({ apiKey: groqApiKey, timeout: requestTimeoutMs, maxRetries: 0 })

          let retries = 3
          while (retries > 0) {
            try {
              const groqResult = await groq.audio.transcriptions.create({
                file: fs.createReadStream(file),
                model: 'whisper-large-v3-turbo',
                temperature: 0,
                response_format: 'verbose_json',
                prompt
              })
              console.log('[Main] Direct Groq transcription successful')
              return groqResult.text
            } catch (error) {
              retries--
              if (retries === 0) {
                console.error('Direct Groq transcription failed after 3 attempts:', error)
                break
              } else {
                console.log(`Direct Groq failed, retrying... (${retries} attempts left)`, error)
                await new Promise((resolve) => setTimeout(resolve, 1000))
              }
            }
          }

          return null
        }

        const transcribeWithServer = async (): Promise<string | null> => {
          const session = safeStorageService.getAuthSession()
          const userId = session?.user?.id?.trim()
          let accessToken = keyCacheService.getAccessToken() || session?.accessToken?.trim() || null
          if (!userId || !accessToken) {
            console.log('[Main] No auth session available for server-mediated transcription')
            return null
          }

          // Reuse one identity across transport retries so an uncertain response
          // can never reserve or bill the same recording twice. Clicking the
          // visible Retry button starts a new IPC call and receives a new key.
          const idempotencyKey = createTranscriptionIdempotencyKey()
          const multipart = await encodeTranscriptionMultipart(
            fs.readFileSync(file),
            mime,
            ext,
            prompt
          )

          const doTranscribe = async (token: string): Promise<Response> => {
            const url = new URL('/api/v1/transcribe', serverProfileService.getActiveOrigin())
            url.searchParams.set('userId', userId)

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs)

            try {
              return await fetch(url.toString(), {
                method: 'POST',
                headers: createTranscriptionRequestHeaders(
                  token,
                  idempotencyKey,
                  multipart.contentType
                ),
                body: multipart.body,
                signal: controller.signal
              })
            } finally {
              clearTimeout(timeoutId)
            }
          }

          let retries = 3
          while (retries > 0) {
            try {
              let response = await doTranscribe(accessToken!)
              if (
                response.status === 401 &&
                (await keyCacheService.recoverAccessTokenAfterUnauthorized(accessToken!))
              ) {
                accessToken =
                  keyCacheService.getAccessToken() ||
                  safeStorageService.getAuthSession()?.accessToken ||
                  null
                if (accessToken) {
                  response = await doTranscribe(accessToken)
                }
              }

              if (!response.ok) {
                const errText = await response.text().catch(() => '')
                throw new Error(`Server transcription failed (${response.status}): ${errText.slice(0, 200)}`)
              }

              const data = (await response.json()) as { text?: string; error?: string }
              if (data.error) {
                throw new Error(data.error)
              }
              keyCacheService.markAccessTokenAccepted(accessToken!)
              console.log('[Main] Server-mediated transcription successful')
              return data.text ?? null
            } catch (error) {
              retries--
              if (retries === 0) {
                console.error('Server transcription failed after 3 attempts:', error)
                break
              } else {
                console.log(`Server transcription failed, retrying... (${retries} attempts left)`, error)
                await new Promise((resolve) => setTimeout(resolve, 1000))
              }
            }
          }

          return null
        }

        // Check transcription priority (local-first vs cloud-first with fallback)
        const priority = settingsService.transcriptionPriority || 'local'
        const isParakeetSelected = primaryLocalModel.startsWith('parakeet_')
        const parakeetAvailable = parakeetService.isAvailable()
        const parakeetReady =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parakeetAvailable && parakeetService.isServerReady(primaryLocalModel as any)

        // Helper to try all local transcription methods
        const tryLocalTranscription = async (): Promise<string | null> => {
          // Try Parakeet if selected and ready
          if (isParakeetSelected && parakeetReady) {
            console.log(`[Main] Parakeet server ready, transcribing with ${primaryLocalModel}...`)
            try {
              const result = await parakeetService.transcribe(
                file,
                { temperature: 0, prompt, timeout: requestTimeoutMs },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                primaryLocalModel as any
              )
              if (result.text) {
                console.log('[Main] Parakeet transcription successful')
                return result.text
              }
            } catch (error) {
              console.error('[Main] Parakeet transcription failed:', error)
            }
          } else if (isParakeetSelected && !parakeetReady) {
            console.log('[Main] Parakeet server not ready yet...')
          }

          // Try selected Whisper model (if not Parakeet and not base)
          if (canUseLocal && !isParakeetSelected && primaryLocalModel !== 'openai_whisper-base') {
            console.log(`[Main] Trying selected Whisper model ${primaryLocalModel}...`)
            const whisperText = await transcribeWithLocal(primaryLocalModel, 3000)
            if (whisperText) return whisperText
          }

          // Try Whisper base as local fallback
          if (baseAvailable) {
            console.log('[Main] Trying Whisper base model...')
            const baseText = await transcribeWithLocal('openai_whisper-base')
            if (baseText) return baseText
          }

          return null
        }

        // Helper to try cloud transcription: direct Groq first, server-mediated fallback
        const tryCloudTranscription = async (): Promise<string | null> => {
          console.log('[Main] Trying direct Groq transcription...')
          const directResult = await transcribeWithGroqDirect()
          if (directResult) return directResult

          console.log('[Main] Direct Groq unavailable or failed, falling back to server-mediated...')
          return await transcribeWithServer()
        }

        // Execute based on priority with automatic fallback
        if (priority === 'local') {
          // Local first, cloud as fallback
          console.log('[Main] Transcription priority: LOCAL first')
          transcriptionText = (await tryLocalTranscription()) ?? ''
          if (!transcriptionText) {
            console.log('[Main] Local transcription failed, falling back to cloud...')
            transcriptionText = (await tryCloudTranscription()) ?? ''
          }
        } else {
          // Cloud first, local as fallback
          console.log('[Main] Transcription priority: CLOUD first')
          transcriptionText = (await tryCloudTranscription()) ?? ''
          if (!transcriptionText) {
            console.log('[Main] Cloud transcription failed, falling back to local...')
            transcriptionText = (await tryLocalTranscription()) ?? ''
          }
        }

        if (!transcriptionText) {
          throw new Error('All transcription methods failed (both local and cloud)')
        }

        transcriptionText = transcriptionText.trim()
        const transcription = { text: transcriptionText }

        // Record transcription usage for subscription tracking
        // Duration comes from the renderer already in seconds
        const durationInSeconds = Math.max(1, Math.round(duration))
        console.log(
          `[Transcription] Recording usage: ${durationInSeconds}s (raw duration: ${duration}s)`
        )
        console.log('[Transcription] Calling subscriptionService.recordTranscriptionUsage...')
        subscriptionService.recordTranscriptionUsage(durationInSeconds)
        console.log('[Transcription] Usage recording complete')

        // ── Wake word detection ──────────────────────────────────────────────
        console.log(
          '[Agent] Wake check — enabled:',
          settingsService.agenticWakeWordEnabled,
          '| text:',
          JSON.stringify(transcriptionText.slice(0, 40))
        )
        if (settingsService.agenticWakeWordEnabled && WAKE_WORD_RE.test(transcriptionText)) {
          const command = transcriptionText.replace(WAKE_WORD_RE, '').trim()
          console.log('[Agent] Wake word detected, command:', command)
          settingsService.lastRecordingMode = 'idle'
          const { agentService } = await import('../services/agent/agent-service')
          agentService.run(command) // fire-and-forget; notifies renderer via IPC
          return { text: '', agentMode: true }
        }

        if (settingsService.lastRecordingMode === 'assistant') {
          // ── Intent classifier: no selected text → route tasks to agent ──
          if (!settingsService.selectedTextBeforeRecording) {
            const intent = await classifyIntent(transcriptionText)
            console.log('[Intent] Classified as:', intent)
            if (intent === 'TASK') {
              settingsService.lastRecordingMode = 'idle'
              const { agentService } = await import('../services/agent/agent-service')
              agentService.run(transcriptionText) // fire-and-forget
              return { text: '', agentMode: true }
            }
            // GENERATE: fall through to one-shot assistant processing
          }

          let screenshot: string | null = null

          if (settingsService.assistantScreenshotEnabled) {
            screenshot = await systemUtils.captureScreenshot(
              settingsService.assistantScreenshotEnabled
            )
            console.log('Screenshot captured:', screenshot ? 'yes' : 'no')
          }

          const { processAssistantRequest } = await import('../services/ai-assistant')
          const groqKey = await keyCacheService.getKey('groq')
          const aiResponse = await processAssistantRequest({
            instructions: transcription.text ?? '',
            selectedText: settingsService.selectedTextBeforeRecording,
            screenshot: screenshot,
            model: settingsService.assistantModel,
            apiKey: groqKey || undefined
          })

          settingsService.selectedTextBeforeRecording = null
          settingsService.lastRecordingMode = 'idle'

          const trimmedResponse = aiResponse.trim()
          const wordsIn = (transcription.text ?? '')
            .trim()
            .split(/\s+/)
            .filter((word) => word.length > 0).length
          const wordsOut = trimmedResponse
            .trim()
            .split(/\s+/)
            .filter((word) => word.length > 0).length
          saveTranscriptionToHistory(trimmedResponse, wordsIn, wordsOut, durationInSeconds)
          return { text: trimmedResponse }
        }

        if (
          settingsService.lastRecordingMode === 'transcription' &&
          settingsService.smartTranscriptionEnabled
        ) {
          const contextInfo = settingsService.contextAwareCapitalizationEnabled
            ? {
                isMidSentence: settingsService.isMidSentence,
                precedingText: settingsService.precedingTextContext || '',
                followingText: settingsService.followingTextContext || ''
              }
            : undefined

          const enhanceGroqKey = await keyCacheService.getKey('groq')
          let enhancedText = await enhanceTranscription(
            transcription.text ?? '',
            undefined,
            enhanceGroqKey || undefined,
            smartTranscriptionModePrompt,
            contextInfo
          )

          // Post-processing: Strip trailing punctuation if there's text after cursor
          // This is a fallback in case the LLM ignores the instruction
          if (contextInfo?.followingText && contextInfo.followingText.trim().length > 0) {
            enhancedText = enhancedText.replace(/[.!?]+\s*$/, '')
            console.log('[Transcription] Stripped trailing punctuation (followingText exists)')
          }

          settingsService.lastRecordingMode = 'idle'
          const trimmed = enhancedText.trim()
          const wordsIn = (transcription.text ?? '')
            .trim()
            .split(/\s+/)
            .filter((word) => word.length > 0).length
          const wordsOut = trimmed
            .trim()
            .split(/\s+/)
            .filter((word) => word.length > 0).length
          saveTranscriptionToHistory(trimmed, wordsIn, wordsOut, durationInSeconds)
          return { text: trimmed }
        }

        settingsService.lastRecordingMode = 'idle'
        const trimmed = (transcription.text ?? '').trim()
        const wordsIn = trimmed
          .trim()
          .split(/\s+/)
          .filter((word) => word.length > 0).length
        const wordsOut = trimmed
          .trim()
          .split(/\s+/)
          .filter((word) => word.length > 0).length
        saveTranscriptionToHistory(trimmed, wordsIn, wordsOut, durationInSeconds)
        return { text: trimmed }
      } catch (error) {
        saveRecoveryRecording()
        throw error
      } finally {
        // Save recording copy if enabled, then cleanup temp files
        saveRecording()
        cleanupRecordings()
        cleanupTempFiles()
      }
    }
  )

  ipcMain.handle('stt:paste', async (_evt, { text }: { text: string }) => {
    return systemUtils.pasteText(
      text,
      settingsService.autoCopyEnabled,
      settingsService.pressEnterAfterEnabled
    )
  })

  ipcMain.handle('settings:update-agentic-wake-word', (_evt, enabled: boolean) => {
    settingsService.agenticWakeWordEnabled = enabled
    console.log('[Settings] Agentic wake word enabled:', enabled)
  })

  ipcMain.handle('recording:open-folder', async () => {
    const recordingsDir = getRecordingsDir()
    mkdirSync(recordingsDir, { recursive: true })
    return shell.openPath(recordingsDir)
  })
}
