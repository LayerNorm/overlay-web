import { evaluateQuota } from '@overlay/billing'
import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getBillingProgrammaticSubjectId, getTrustedAutomationBillingSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getServerProviderKey } from '@/server/ai/gateway/server-provider-keys'
import { isPaidPlan } from '@/server/billing/billing-runtime'
import { billingPayerErrorResponse } from '@/server/billing/billing-payer-error-response'
import {
  transcriptionProviderCostUsd,
  trustedTranscriptionDurationSeconds,
  type GroqVerboseTranscription,
} from '@/server/billing/transcription-billing'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const TRANSCRIPTION_MODEL = 'groq/whisper-large-v3-turbo'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const workspaceId = context.workspace.workspace.id
    const programmaticSubjectId = getBillingProgrammaticSubjectId(context, getTrustedAutomationBillingSubjectId(context))


    const serverContext = getOverlayServerContext()
    const entitlements = await serverContext.generationUsagePolicy.getEntitlements({ programmaticSubjectId, userId: auth.userId, workspaceId })
    if (!entitlements) return NextResponse.json({ error: 'Could not verify subscription.' }, { status: 401 })
    if (!isPaidPlan(entitlements)) {
      return NextResponse.json(
        {
          error: 'hosted_transcription_requires_paid_plan',
          message: 'Hosted transcription requires a paid plan. Local on-device transcription remains available.',
        },
        { status: 403 },
      )
    }
    const quota = evaluateQuota(entitlements, { transcriptionSecondsRequested: 1 })
    if (!entitlements.localTranscriptionEnabled && !quota.allowed) {
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

    const groqApiKey = await getServerProviderKey('groq')

    if (groqApiKey) {
      const check = await serverContext.generationUsagePolicy.ensureBudgetNotLow({
        entitlements,
        kind: 'transcription',
        modelId: TRANSCRIPTION_MODEL,
        operationId: 'audio.transcribe',
        programmaticSubjectId,
        userId: auth.userId,
        workspaceId,
      })
      if (!check.ok) {
        return NextResponse.json({ ...check.payload, error: check.code }, { status: check.status })
      }

      // Preserve the original filename (e.g. audio.m4a) so Groq picks the right
      // decoder. Sending 'audio.webm' for an M4A file causes intermittent 400s.
      const fileName = audioFile.name || 'audio.m4a'
      const groqFormData = new FormData()
      groqFormData.append('file', audioFile, fileName)
      groqFormData.append('model', 'whisper-large-v3-turbo')
      groqFormData.append('response_format', 'verbose_json')
      groqFormData.append('timestamp_granularities[]', 'segment')
      if (prompt) {
        groqFormData.append('prompt', prompt)
      }

      // A failed call charges nothing; a finished one is charged for the audio the provider reports.
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

      const data = await groqResponse.json() as GroqVerboseTranscription
      const durationSeconds = trustedTranscriptionDurationSeconds(data)
      if (durationSeconds === null) {
        logger.error('[Transcribe] Groq response is missing its duration; nothing was charged')
        return NextResponse.json({ error: 'Transcription provider returned incomplete usage metadata.' }, { status: 502 })
      }
      await serverContext.generationUsagePolicy.charge({
        operationId: `audio.transcribe:${globalThis.crypto.randomUUID()}`,
        programmaticSubjectId,
        providerCostUsd: transcriptionProviderCostUsd(durationSeconds),
        usage: { kind: 'transcription', modelId: TRANSCRIPTION_MODEL, durationSeconds },
        userId: auth.userId,
        workspaceId,
      })
      return NextResponse.json({ text: typeof data.text === 'string' ? data.text : '' })
    }

    return NextResponse.json(
      { error: 'No transcription provider configured. Set GROQ_API_KEY.' },
      { status: 500 }
    )
  } catch (error) {
    const billingRefusal = billingPayerErrorResponse(error)
    if (billingRefusal) return billingRefusal
    logger.error('[Transcribe API] Error:', error)
    return NextResponse.json({ error: 'Failed to transcribe audio' }, { status: 500 })
  }
}
