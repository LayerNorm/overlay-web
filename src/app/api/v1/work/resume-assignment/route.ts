import { NextResponse } from 'next/server'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getWorkService } from '@/server/work'
import { workErrorResponse } from '@/server/app-api/v1/work/shared'

export async function POST(request: Request) {
  let authorized = false
  try { authorized = matchesInternalApiSecret(request.headers.get('x-internal-api-secret'), getInternalApiSecret()) }
  catch (_error) { return NextResponse.json({ error: 'unavailable' }, { status: 503 }) }
  if (!authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try { body = await request.json() }
  catch (_error) { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }) }
  if (!body || typeof body.workspaceId !== 'string' || typeof body.userId !== 'string'
    || typeof body.id !== 'string' || !Number.isSafeInteger(body.generation)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  try {
    await getWorkService().resumeAssignment({ workspaceId: body.workspaceId, userId: body.userId, id: body.id, generation: body.generation as number })
    return NextResponse.json({ accepted: true }, { status: 202 })
  } catch (error) { return workErrorResponse(error) }
}
