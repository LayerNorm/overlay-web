import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { convex } from '@/server/database/convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getServerProviderKey } from '@/server/ai/gateway/server-provider-keys'
import type { Entitlements } from '@/shared/app/app-contracts'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const ESTIMATED_TRANSCRIPTION_SECONDS = 60

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context


    const serverSecret = getInternalApiSecret()
    const entitlements = await convex.query<Entitlements>('platform/usage:getEntitlementsByServer', {
      serverSecret,
      userId: auth.userId,
    })
    if (!entitlements) return NextResponse.json({ error: 'Could not verify subscription.' }, { status: 401 })
    const remainingSeconds =
      (entitlements.transcriptionSecondsLimit ?? 0) - (entitlements.transcriptionSecondsUsed ?? 0)
    if (!entitlements.localTranscriptionEnabled && remainingSeconds <= 0) {
      return NextResponse.json({ error: 'transcription_limit_exceeded' }, { status: 403 })
    }

    const formData = await request.formData()
    const audioFile = formData.get('audio') as File
    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }
    if (audioFile.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'Audio file is too large' }, { status: 413 })
    }

    const prompt = (formData.get('prompt') as string | null) || undefined

    const groqApiKey = (await getServerProviderKey('groq')) ?? process.env.GROQ_API_KEY

    if (groqApiKey) {
      // Preserve the original filename (e.g. audio.m4a) so Groq picks the right
      // decoder. Sending 'audio.webm' for an M4A file causes intermittent 400s.
      const fileName = audioFile.name || 'audio.m4a'
      const groqFormData = new FormData()
      groqFormData.append('file', audioFile, fileName)
      groqFormData.append('model', 'whisper-large-v3-turbo')
      groqFormData.append('response_format', 'json')
      if (prompt) {
        groqFormData.append('prompt', prompt)
      }

      const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqApiKey}` },
        body: groqFormData,
      })

      if (!groqResponse.ok) {
        const err = await groqResponse.text()
        logger.error('[Transcribe] Groq error:', err)
        return NextResponse.json(
          { error: 'Groq transcription failed. Check GROQ_API_KEY and audio codec support.' },
          { status: 500 }
        )
      }

      const data = await groqResponse.json()
      await convex.mutation('platform/usage:recordBatch', {
        serverSecret,
        userId: auth.userId,
        events: [{
          type: 'transcription',
          modelId: 'groq/whisper-large-v3-turbo',
          cost: ESTIMATED_TRANSCRIPTION_SECONDS,
          timestamp: Date.now(),
        }],
      })
      return NextResponse.json({ text: data.text })
    }

    return NextResponse.json(
      { error: 'No transcription provider configured. Set GROQ_API_KEY.' },
      { status: 500 }
    )
  } catch (error) {
    logger.error('[Transcribe API] Error:', error)
    return NextResponse.json({ error: 'Failed to transcribe audio' }, { status: 500 })
  }
}
