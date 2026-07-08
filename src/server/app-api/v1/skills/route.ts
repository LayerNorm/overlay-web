import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { lazyConvex as convex } from '@/server/database/lazy-convex'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const projectId = request.nextUrl.searchParams.get('projectId')
    const skills = await convex.query('integrations/skills:list', {
      userId: auth.userId,
      serverSecret,
      projectId: projectId ?? undefined,
    })
    return NextResponse.json(skills || [])
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to fetch skills' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json()
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const { name, description, instructions, projectId } = body as Record<string, unknown>
    const nameText = typeof name === 'string' ? name.trim() : ''
    const descriptionText = typeof description === 'string' ? description.trim() : ''
    const instructionsText = typeof instructions === 'string' ? instructions.trim() : ''
    if (!nameText || !descriptionText || !instructionsText) {
      return NextResponse.json({ error: 'name, description, and instructions are required' }, { status: 400 })
    }

    const skillId = await convex.mutation<string>('integrations/skills:create', {
      userId: auth.userId,
      serverSecret,
      name: nameText,
      description: descriptionText,
      instructions: instructionsText,
      projectId: projectId ?? undefined,
    })
    return NextResponse.json({ id: skillId })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to create skill' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json()
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const { skillId, name, description, instructions, enabled } = body as Record<string, unknown>
    if (!skillId) return NextResponse.json({ error: 'skillId required' }, { status: 400 })

    await convex.mutation('integrations/skills:update', {
      skillId,
      userId: auth.userId,
      serverSecret,
      name,
      description,
      instructions,
      enabled,
    })
    return NextResponse.json({ success: true })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to update skill' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const skillId = request.nextUrl.searchParams.get('skillId')
    if (!skillId) return NextResponse.json({ error: 'skillId required' }, { status: 400 })

    await convex.mutation('integrations/skills:remove', {
      skillId,
      userId: auth.userId,
      serverSecret,
    })
    return NextResponse.json({ success: true })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 })
  }
}
