import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { environmentIdFrom } from '../../shared'

/**
 * Copies a folder on the person's own Mac into Overlay Files once (internal/develop/thread-folders.md). Only the
 * person who connected the Mac can do this, while it is online.
 */
export async function POST(_request: Request, context: AppApiRouteContext) {
  const { copyMacFolderToFiles, ThreadWorkError } = await import('@/server/agents/thread-work/thread-work-service')
  const body = context.parsedJson as { path?: unknown; scope?: unknown }
  if (typeof body.path !== 'string') return NextResponse.json({ error: 'path is required' }, { status: 400 })
  try {
    const result = await copyMacFolderToFiles({
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      environmentId: await environmentIdFrom(context),
      path: body.path,
      scope: body.scope === 'workspace' ? 'workspace' : 'personal',
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ThreadWorkError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === 'invalid_path' ? 400 : 409 })
    }
    throw error
  }
}
