import 'server-only'

import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { repositoryProxy } from '@/server/app-data/errors'
import { AutomationService, AutomationServiceError } from './AutomationService'
import type { AutomationRepository } from './AutomationRepository'

export const automationService = new AutomationService({
  repository: repositoryProxy<AutomationRepository>(
    () => getOverlayServerContext().appData.repositories.automations,
  ),
})

export function automationErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AutomationServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}
