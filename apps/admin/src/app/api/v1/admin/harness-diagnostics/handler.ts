import { NextResponse, type NextRequest } from 'next/server'
import type { AdministrativeRole } from '@/server/admin/AdministrativeRepository'
import type { AdminRouteContext } from '@/server/guard'

const DIAGNOSTIC_READ_ROLES = new Set<AdministrativeRole>(['admin', 'auditor', 'support'])

export function createHarnessDiagnosticHandler(lookup: (diagnosticId: string) => Promise<unknown>) {
  return async (request: NextRequest, context: AdminRouteContext): Promise<Response> => {
    if (!DIAGNOSTIC_READ_ROLES.has(context.operator.principal.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const keys = [...request.nextUrl.searchParams.keys()]
    const diagnosticId = request.nextUrl.searchParams.get('diagnosticId')
    if (keys.length !== 1 || keys[0] !== 'diagnosticId'
      || !diagnosticId || !/^[A-Za-z0-9_-]{1,128}$/.test(diagnosticId)) {
      return NextResponse.json({ error: 'Provide exactly one valid diagnosticId.' }, { status: 400 })
    }
    const diagnostic = await lookup(diagnosticId)
    return NextResponse.json(diagnostic, { headers: { 'Cache-Control': 'no-store' } })
  }
}
