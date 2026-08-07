import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

function repository() {
  return getOverlayServerContext().appData.repositories.skills
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const projectId = request.nextUrl.searchParams.get('projectId') || undefined
    return NextResponse.json(await repository().list({ userId: context.auth.userId, projectId }))
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to fetch skills' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = Object.keys(context.parsedJson).length > 0 ? context.parsedJson : await request.json()
    const name = stringValue(body.name)
    const description = stringValue(body.description)
    const instructions = stringValue(body.instructions)
    const projectId = optionalString(body.projectId)
    if (!name || !description || !instructions) {
      return NextResponse.json(
        { error: 'name, description, and instructions are required' },
        { status: 400 },
      )
    }
    const id = await repository().create({
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      name,
      description,
      instructions,
      projectId,
    })
    return NextResponse.json({ id })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to create skill' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = Object.keys(context.parsedJson).length > 0 ? context.parsedJson : await request.json()
    const skillId = stringValue(body.skillId)
    if (!skillId) return NextResponse.json({ error: 'skillId required' }, { status: 400 })
    await repository().update({
      skillId,
      userId: context.auth.userId,
      ...(body.name !== undefined ? { name: stringValue(body.name) } : {}),
      ...(body.description !== undefined ? { description: stringValue(body.description) } : {}),
      ...(body.instructions !== undefined ? { instructions: stringValue(body.instructions) } : {}),
      ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
    })
    return NextResponse.json({ success: true })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to update skill' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const skillId = request.nextUrl.searchParams.get('skillId')
    if (!skillId) return NextResponse.json({ error: 'skillId required' }, { status: 400 })
    await repository().remove({ skillId, userId: context.auth.userId })
    return NextResponse.json({ success: true })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 })
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalString(value: unknown): string | undefined {
  const normalized = stringValue(value)
  return normalized || undefined
}
