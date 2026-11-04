import { NextResponse } from 'next/server'
import { start } from 'workflow/api'
import { nativeHarnessWorkflow } from '@/server/workflows/native-harness'
import { personalHarnessWorkflow } from '@/server/workflows/personal-harness'
import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'

export async function POST(request: Request) {
  let authorized = false
  try {
    authorized = matchesInternalApiSecret(request.headers.get('x-internal-api-secret'), getInternalApiSecret())
  } catch (_error) {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }
  if (!authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { runId?: unknown; generation?: unknown; checkpointToken?: unknown }
  try {
    body = await request.json() as typeof body
  } catch (_error) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  if (typeof body.runId !== 'string' || !Number.isSafeInteger(body.generation)
    || typeof body.checkpointToken !== 'string') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const generation = body.generation as number
  const launch = await new ConvexHarnessRepository().getContinuationLaunch({
    runId: body.runId, generation, checkpointToken: body.checkpointToken,
  })
  if (!launch) return NextResponse.json({ accepted: true, duplicate: true }, { status: 202 })
  const input = JSON.parse(launch.launchInputJson) as Record<string, unknown>
  const checkpoint = JSON.parse(launch.checkpointJson)
  const access = input.access as { runId?: unknown; executionGeneration?: unknown } | undefined
  if (access?.runId !== body.runId || access.executionGeneration !== generation) {
    return NextResponse.json({ error: 'invalid_checkpoint' }, { status: 409 })
  }
  input.continuation = checkpoint
  if (launch.workflowKind === 'native') {
    await start(nativeHarnessWorkflow, [input as never])
  } else {
    await start(personalHarnessWorkflow, [input as never])
  }
  return NextResponse.json({ accepted: true }, { status: 202 })
}
