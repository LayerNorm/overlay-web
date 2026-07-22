'use client'

import { useSearchParams } from 'next/navigation'
import { AutomationGraphCanvas } from '@overlay/modules-react/automations'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { Button } from '@overlay/ui'
import { useGuestGate } from '@/components/providers/GuestGateProvider'
import { SHOWCASE_AUTOMATIONS } from './showcase-data'

const flows: Record<string, string> = {
  briefing: 'flowchart TD\nmail["Read priority email"]\ncalendar["Review today’s meetings"]\nbrief["Create customer briefing"]\nmail --> calendar\ncalendar --> brief',
  research: 'flowchart TD\nsearch["Search trusted sources"]\ncompare["Compare product changes"]\nreport["Save cited report"]\nsearch --> compare\ncompare --> report',
  followup: 'flowchart TD\nmeeting["Read meeting transcript"]\ndecisions["Extract decisions"]\ndrafts["Prepare follow-ups for review"]\nmeeting --> decisions\ndecisions --> drafts',
}

export function PublicShowcaseAutomationsView() {
  const searchParams = useSearchParams()
  const { requireAuth } = useGuestGate()
  const selectedId = (searchParams?.get('automationId') ?? 'showcase-briefing').replace(/^showcase-/, '')
  const selected = SHOWCASE_AUTOMATIONS.find((automation) => automation.id === selectedId) ?? SHOWCASE_AUTOMATIONS[0]!

  return (
    <AppScreenShell
      header={(
        <AppScreenHeader>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">{selected.name}</h1>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{selected.schedule}</p>
            </div>
            <Button size="sm" onClick={() => requireAuth('nav')}>Use automation</Button>
          </div>
        </AppScreenHeader>
      )}
    >
      <AppScreenBody className="overflow-auto" maxWidth="lg">
        <div className="mx-auto w-full max-w-4xl py-6">
          <p className="mb-6 max-w-2xl text-sm leading-6 text-[var(--muted)]">{selected.description}</p>
          <AutomationGraphCanvas source={flows[selected.id] ?? ''} />
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}
