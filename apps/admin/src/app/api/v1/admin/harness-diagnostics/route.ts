import { adminConvexQuery } from '@/server/convex-admin'
import { adminRoute } from '@/server/guard'
import { createHarnessDiagnosticHandler } from './handler'

export const GET = adminRoute(createHarnessDiagnosticHandler(diagnosticId =>
  adminConvexQuery('admin/console:lookupHarnessDiagnostic', { diagnosticId })), {
  auditAction: 'administration.harness_diagnostic.read', resourceType: 'harness_diagnostic',
})
