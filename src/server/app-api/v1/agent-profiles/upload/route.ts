import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { AgentProfileError, MAX_PROFILE_UPLOAD_BYTES } from '@/server/agents/profiles/agent-profile-codec'
import { enforceAgentHostRateLimit } from '../../agent-environments/host-security'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * A person's computer (or browser) uploads a cleaned Claude Code or Codex profile for one of their agents. Authenticated by
 * the one-time import code the agent's page created; the code is single-use and expires in 15 minutes. The upload is
 * cleaned again here before it is stored.
 */
export async function POST(request: Request) {
  try {
    const limited = await enforceAgentHostRateLimit(request, 'profile-upload', 10)
    if (limited) return limited
    const header = request.headers.get('authorization') ?? ''
    const code = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
    if (!code) throw new AgentProfileError('Send the import code as a bearer token.', 401, 'import_code_invalid')
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (declared > MAX_PROFILE_UPLOAD_BYTES) throw new AgentProfileError('The import is too large to upload.', 413, 'profile_upload_size')
    const body = new Uint8Array(await request.arrayBuffer())
    const result = await getOverlayServerContext().agentProfiles.receiveUpload({ code, body })
    return NextResponse.json({ ok: true, profileId: result.profileId }, { status: 201, headers: NO_STORE })
  } catch (error) {
    if (error instanceof AgentProfileError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode, headers: NO_STORE })
    }
    logger.error('[agent-profiles] upload failed', { error: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ error: 'Could not complete the upload.', code: 'internal_error' }, { status: 500, headers: NO_STORE })
  }
}
