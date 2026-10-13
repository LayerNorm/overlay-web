'use client'
import { List, Columns3, ChartGantt } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { resolveWorkView } from '@/shared/work/view'
import { AppScreenBody, AppScreenShell } from '@overlay/modules-react/shell'

export default function WorkScreen() {
  const params = useSearchParams()
  const view = resolveWorkView(params.get('view'))
  const Icon = view === 'board' ? Columns3 : view === 'timeline' ? ChartGantt : List
  return <AppScreenShell>
    <header className="flex h-16 shrink-0 items-center border-b border-(--border) px-6">
      <h1 className="text-lg font-medium lowercase tracking-tight" style={{ fontFamily: 'var(--font-serif)' }}>work</h1>
    </header>
    <AppScreenBody padding="none" maxWidth="none" className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center"><Icon size={24} strokeWidth={1.5} className="mx-auto mb-4 text-(--muted)" />
        <h2 className="text-sm font-medium">No tasks yet</h2><p className="mt-2 text-sm text-(--muted)">Keep your work together, from the first step to the finish.</p>
      </div>
    </AppScreenBody>
  </AppScreenShell>
}
