import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { scopeForbiddenResponse } from '@/server/app-api/scope-errors'
import { parseResourceScope, parseResourceView } from '@/shared/workspaces/resource-scope'
import type { SkillVerticalFields } from '@/server/extensions/SkillRepository'

function repository() {
  return getOverlayServerContext().appData.repositories.skills
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    return NextResponse.json(await repository().list({
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      view: parseResourceView(request.nextUrl.searchParams.get('view')),
    }))
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
      scope: parseResourceScope(body.scope),
      ...parseVerticalFields(body),
    })
    return NextResponse.json({ id })
  } catch (error) {
    return scopeForbiddenResponse(error) ?? NextResponse.json({ error: 'Failed to create skill' }, { status: 500 })
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
      workspaceId: context.workspace.workspace.id,
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
    await repository().remove({ skillId, userId: context.auth.userId, workspaceId: context.workspace.workspace.id })
    return NextResponse.json({ success: true })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 })
  }
}

const DOMAIN_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const PROVENANCE_KINDS = new Set(['web', 'registry', 'workspace', 'chat'])

/** Optional self-verticalization fields. Invalid entries are dropped rather than failing the save. */
export function parseVerticalFields(body: Record<string, unknown>): SkillVerticalFields {
  const fields: SkillVerticalFields = {}
  const domain = stringValue(body.domain).toLowerCase()
  if (domain && DOMAIN_SLUG.test(domain)) fields.domain = domain
  if (body.kind === 'skill' || body.kind === 'domain_map') fields.kind = body.kind
  if (body.origin === 'user' || body.origin === 'agent' || body.origin === 'registry') fields.origin = body.origin
  if (Array.isArray(body.triggers)) {
    const triggers = body.triggers.map(stringValue).filter(t => t.length > 0 && t.length <= 200).slice(0, 20)
    if (triggers.length) fields.triggers = triggers
  }
  if (Array.isArray(body.provenance)) {
    const provenance = body.provenance.flatMap((raw): NonNullable<SkillVerticalFields['provenance']> => {
      if (!raw || typeof raw !== 'object') return []
      const entry = raw as Record<string, unknown>
      const kind = stringValue(entry.kind)
      const ref = stringValue(entry.ref)
      if (!PROVENANCE_KINDS.has(kind) || !ref || ref.length > 2_000) return []
      const title = stringValue(entry.title).slice(0, 300)
      return [{
        kind: kind as 'web' | 'registry' | 'workspace' | 'chat',
        ref,
        ...(title ? { title } : {}),
        ...(typeof entry.retrievedAt === 'number' && Number.isFinite(entry.retrievedAt) ? { retrievedAt: entry.retrievedAt } : {}),
      }]
    }).slice(0, 50)
    if (provenance.length) fields.provenance = provenance
  }
  return fields
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

