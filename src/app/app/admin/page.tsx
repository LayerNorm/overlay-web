'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Search, ShieldCheck, WalletCards } from 'lucide-react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { AuthorizationAdminPanel } from '@/features/admin/authorization/AuthorizationAdminPanel'

type UsageRow = {
  userId: string
  email?: string
  planKind: 'free' | 'paid'
  status?: string
  budgetUsedCents: number
  budgetTotalCents: number
  budgetRemainingCents: number
}

type AuditRow = {
  id: string
  action: string
  actorUserId?: string
  resourceType: string
  resourceId?: string
  outcome: string
  createdAt: number
}

export default function AdminPage() {
  const [section, setSection] = useState<'overview' | 'roles' | 'groups'>('overview')
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [events, setEvents] = useState<AuditRow[]>([])
  const [userFilter, setUserFilter] = useState('')
  const [auditFilter, setAuditFilter] = useState('')
  const [adjustUserId, setAdjustUserId] = useState('')
  const [amountCents, setAmountCents] = useState('')
  const [busy, setBusy] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const usageUrl = new URL('/api/v1/admin/usage', window.location.origin)
    if (userFilter.trim()) usageUrl.searchParams.set('userId', userFilter.trim())
    const auditUrl = new URL('/api/v1/admin/audit', window.location.origin)
    if (auditFilter.trim()) auditUrl.searchParams.set('action', auditFilter.trim())
    const [usageResponse, auditResponse] = await Promise.all([
      fetch(usageUrl, { cache: 'no-store' }),
      fetch(auditUrl, { cache: 'no-store' }),
    ])
    if (usageResponse.status === 403 || auditResponse.status === 403) {
      setForbidden(true)
      return
    }
    if (!usageResponse.ok || !auditResponse.ok) throw new Error('Failed to load administration data')
    setForbidden(false)
    setUsage((await usageResponse.json() as { usage: UsageRow[] }).usage)
    setEvents((await auditResponse.json() as { events: AuditRow[] }).events)
  }, [auditFilter, userFilter])

  useEffect(() => {
    void load().catch((loadError) => setError(message(loadError)))
  }, [load])

  async function adjustBudget() {
    const amount = Number(amountCents)
    if (!adjustUserId.trim() || !Number.isFinite(amount) || amount === 0) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/admin/usage', {
        body: JSON.stringify({ amountCents: amount, userId: adjustUserId.trim() }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Budget adjustment failed')
      setAmountCents('')
      await load()
    } catch (adjustError) {
      setError(message(adjustError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppScreenShell
      data-testid="admin-console"
      header={(
        <AppScreenHeader
          title="Administration"
          subtitle="Workspace controls"
          actions={(
            <button
              type="button"
              aria-label="Refresh administration"
              className="inline-flex size-8 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              onClick={() => void load()}
            >
              <RefreshCw size={15} />
            </button>
          )}
          tabs={(
            <nav className="flex gap-5" aria-label="Administration sections">
              {(['overview', 'roles', 'groups'] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-current={section === value ? 'page' : undefined}
                  className={`border-b-2 pb-1.5 text-xs capitalize transition-colors ${section === value ? 'border-[var(--foreground)] font-medium text-[var(--foreground)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'}`}
                  onClick={() => setSection(value)}
                >
                  {value}
                </button>
              ))}
            </nav>
          )}
        />
      )}
    >
      <AppScreenBody maxWidth="xl" padding="md">
        {error ? <p className="mb-5 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        {section !== 'overview' ? <AuthorizationAdminPanel view={section} userDirectory={usage} /> : null}

        {section === 'overview' && forbidden ? (
          <div className="py-12" data-testid="admin-forbidden">
            <ShieldCheck size={22} />
            <h2 className="mt-4 text-lg font-semibold">Administrative access required</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">This account cannot view usage or audit data.</p>
          </div>
        ) : null}

        {section === 'overview' && !forbidden ? <><section data-testid="admin-usage">
        <div className="flex items-center gap-2"><WalletCards size={17} /><h2 className="text-sm font-semibold">Usage and budgets</h2></div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-[var(--muted)]" size={15} />
            <input aria-label="Filter usage by user ID" className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-sm" placeholder="User ID" value={userFilter} onChange={(event) => setUserFilter(event.target.value)} />
          </div>
          <button type="button" className="h-9 rounded-md border border-[var(--border)] px-4 text-sm" onClick={() => void load()}>Apply filter</button>
        </div>
        <div className="mt-4 overflow-x-auto border-y border-[var(--border)]">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-[var(--muted)]"><tr><th className="py-3">User</th><th>Plan</th><th>Total</th><th>Used</th><th>Remaining</th></tr></thead>
            <tbody className="divide-y divide-[var(--border)]">
              {usage.map((row) => <tr key={row.userId}><td className="py-3"><div className="font-medium">{row.email || row.userId}</div><div className="text-xs text-[var(--muted)]">{row.userId}</div></td><td>{row.planKind}</td><td>{money(row.budgetTotalCents)}</td><td>{money(row.budgetUsedCents)}</td><td>{money(row.budgetRemainingCents)}</td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
          <input aria-label="Budget user ID" className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" placeholder="User ID" value={adjustUserId} onChange={(event) => setAdjustUserId(event.target.value)} />
          <input aria-label="Budget adjustment cents" className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" placeholder="Amount in cents" inputMode="numeric" value={amountCents} onChange={(event) => setAmountCents(event.target.value)} />
          <button type="button" className="h-9 rounded-md bg-[var(--foreground)] px-4 text-sm font-medium text-[var(--background)] disabled:opacity-50" disabled={busy} onClick={() => void adjustBudget()}>Adjust budget</button>
        </div>
      </section>

      <section className="mt-10" data-testid="admin-audit">
        <div className="flex items-center gap-2"><ShieldCheck size={17} /><h2 className="text-sm font-semibold">Audit events</h2></div>
        <div className="mt-4 flex gap-3">
          <input aria-label="Filter audit action" className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" placeholder="Exact action" value={auditFilter} onChange={(event) => setAuditFilter(event.target.value)} />
          <button type="button" className="h-9 rounded-md border border-[var(--border)] px-4 text-sm" onClick={() => void load()}>Search</button>
        </div>
        <div className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {events.length === 0 ? <p className="py-5 text-sm text-[var(--muted)]">No matching audit events.</p> : events.map((event) => (
            <div key={event.id} className="grid gap-1 py-3 text-sm md:grid-cols-[220px_1fr_100px]">
              <div><p className="font-medium">{event.action}</p><p className="text-xs text-[var(--muted)]">{new Date(event.createdAt).toLocaleString()}</p></div>
              <p className="text-[var(--muted)]">{event.resourceType}{event.resourceId ? ` · ${event.resourceId}` : ''}</p>
              <p>{event.outcome}</p>
            </div>
          ))}
        </div>
        </section></> : null}
      </AppScreenBody>
    </AppScreenShell>
  )
}

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: 'USD', style: 'currency' }).format(cents / 100)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Administration request failed'
}
