'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  BookOpen,
  LayoutDashboard,
  ListTree,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { AuthorizationAdminPanel } from '@/features/admin/authorization/AuthorizationAdminPanel'
import { CatalogPolicyAdminPanel } from '@/features/admin/catalog/CatalogPolicyAdminPanel'
import { KnowledgeAdminPanel } from '@/features/admin/knowledge/KnowledgeAdminPanel'
import { GovernanceAdminPanel } from '@/features/admin/governance/GovernanceAdminPanel'
import { useAuthorization } from '@/components/providers/AuthorizationProvider'

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

type AdminSection = 'overview' | 'roles' | 'groups' | 'knowledge' | 'catalog' | 'governance'

type AdminSectionOption = {
  value: AdminSection
  label: string
  Icon: LucideIcon
}

export default function AdminPage() {
  const { can } = useAuthorization()
  const canViewUsage = can('usage.read')
  const canManageUsage = can('usage.manage')
  const canViewAudit = can('audit.read')
  const canViewRoles = can('roles.read')
  const canManageRoles = can('roles.manage')
  const canViewGroups = can('groups.read')
  const canManageGroups = can('groups.manage')
  const canViewKnowledge = can('knowledge.publish') && can('knowledge.share') && can('roles.read')
  const canManageKnowledge = canViewKnowledge && can('roles.manage')
  const canViewCatalog = can('roles.read')
  const canManageCatalog = can('roles.manage')
  const canViewGovernance = can('governance.read')
  const canManageGovernance = can('governance.manage')
  const canExportGovernance = can('governance.export')
  const [section, setSection] = useState<AdminSection>('overview')
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [events, setEvents] = useState<AuditRow[]>([])
  const [userFilter, setUserFilter] = useState('')
  const [auditFilter, setAuditFilter] = useState('')
  const [adjustUserId, setAdjustUserId] = useState('')
  const [amountCents, setAmountCents] = useState('')
  const [busy, setBusy] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sections: AdminSectionOption[] = [
    ...(canViewUsage || canViewAudit ? [{ value: 'overview' as const, label: 'Overview', Icon: LayoutDashboard }] : []),
    ...(canViewRoles ? [{ value: 'roles' as const, label: 'Roles', Icon: ShieldCheck }] : []),
    ...(canViewGroups ? [{ value: 'groups' as const, label: 'Groups', Icon: UsersRound }] : []),
    ...(canViewKnowledge ? [{ value: 'knowledge' as const, label: 'Knowledge', Icon: BookOpen }] : []),
    ...(canViewCatalog ? [{ value: 'catalog' as const, label: 'Catalog', Icon: ListTree }] : []),
    ...(canViewGovernance ? [{ value: 'governance' as const, label: 'Governance', Icon: Scale }] : []),
  ]

  const load = useCallback(async () => {
    const usageUrl = new URL('/api/v1/admin/usage', window.location.origin)
    if (userFilter.trim()) usageUrl.searchParams.set('userId', userFilter.trim())
    const auditUrl = new URL('/api/v1/admin/audit', window.location.origin)
    if (auditFilter.trim()) auditUrl.searchParams.set('action', auditFilter.trim())
    const [usageResponse, auditResponse] = await Promise.all([
      canViewUsage ? fetch(usageUrl, { cache: 'no-store' }) : Promise.resolve(null),
      canViewAudit ? fetch(auditUrl, { cache: 'no-store' }) : Promise.resolve(null),
    ])
    if (usageResponse?.status === 403 || auditResponse?.status === 403) {
      setForbidden(true)
      return
    }
    if (usageResponse && !usageResponse.ok) throw new Error('Failed to load usage data')
    if (auditResponse && !auditResponse.ok) throw new Error('Failed to load audit data')
    setForbidden(false)
    setUsage(usageResponse ? (await usageResponse.json() as { usage: UsageRow[] }).usage : [])
    setEvents(auditResponse ? (await auditResponse.json() as { events: AuditRow[] }).events : [])
  }, [auditFilter, canViewAudit, canViewUsage, userFilter])

  useEffect(() => {
    void load().catch((loadError) => setError(message(loadError)))
  }, [load])

  useEffect(() => {
    if (section === 'overview' && (canViewUsage || canViewAudit)) return
    if (section === 'roles' && canViewRoles) return
    if (section === 'groups' && canViewGroups) return
    if (section === 'knowledge' && canViewKnowledge) return
    if (section === 'catalog' && canViewCatalog) return
    if (section === 'governance' && canViewGovernance) return
    if (canViewUsage || canViewAudit) setSection('overview')
    else if (canViewRoles) setSection('roles')
    else if (canViewGroups) setSection('groups')
    else if (canViewKnowledge) setSection('knowledge')
    else if (canViewCatalog) setSection('catalog')
    else if (canViewGovernance) setSection('governance')
  }, [canViewAudit, canViewCatalog, canViewGovernance, canViewGroups, canViewKnowledge, canViewRoles, canViewUsage, section])

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
      sidebarBehavior="always"
      sidebarClassName="w-12 p-1 sm:w-52 sm:p-2"
      sidebar={(
        <nav aria-label="Administration sections" className="flex flex-col gap-1">
          {sections.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-current={section === value ? 'page' : undefined}
              onClick={() => setSection(value)}
              className={`flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors max-sm:justify-center max-sm:px-0 ${
                section === value
                  ? 'bg-[var(--surface-subtle)] font-medium text-[var(--foreground)]'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
              }`}
            >
              <Icon size={16} strokeWidth={1.75} className="shrink-0" />
              <span className="truncate max-sm:hidden">{label}</span>
            </button>
          ))}
        </nav>
      )}
      header={(
        <AppScreenHeader
          title="Administration"
          subtitle="Workspace controls"
          actions={(
            <>
              <button
                type="button"
                aria-label="Refresh administration"
                className="inline-flex size-8 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                onClick={() => void load()}
              >
                <RefreshCw size={15} />
              </button>
            </>
          )}
        />
      )}
    >
      <AppScreenBody maxWidth="xl" padding="md">
        {error ? <p className="mb-5 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        {section === 'roles' && canViewRoles ? (
          <AuthorizationAdminPanel
            canManage={canManageRoles}
            canManageRoles={canManageRoles}
            canReadRoles={canViewRoles}
            view="roles"
            userDirectory={usage}
          />
        ) : null}
        {section === 'groups' && canViewGroups ? (
          <AuthorizationAdminPanel
            canManage={canManageGroups}
            canManageRoles={canManageRoles}
            canReadRoles={canViewRoles}
            view="groups"
            userDirectory={usage}
          />
        ) : null}
        {section === 'knowledge' && canViewKnowledge ? (
          <KnowledgeAdminPanel canManage={canManageKnowledge} />
        ) : null}
        {section === 'catalog' && canViewCatalog ? (
          <CatalogPolicyAdminPanel canManage={canManageCatalog} />
        ) : null}
        {section === 'governance' && canViewGovernance ? (
          <GovernanceAdminPanel
            canExport={canExportGovernance}
            canManage={canManageGovernance}
          />
        ) : null}

        {section === 'overview' && (forbidden || (!canViewUsage && !canViewAudit)) ? (
          <div className="py-12" data-testid="admin-forbidden">
            <ShieldCheck size={22} />
            <h2 className="mt-4 text-lg font-semibold">Administrative access required</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">This account cannot view usage or audit data.</p>
          </div>
        ) : null}

        {section === 'overview' && !forbidden && (canViewUsage || canViewAudit) ? <>{canViewUsage ? <section data-testid="admin-usage">
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
        {canManageUsage ? <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
          <input aria-label="Budget user ID" className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" placeholder="User ID" value={adjustUserId} onChange={(event) => setAdjustUserId(event.target.value)} />
          <input aria-label="Budget adjustment cents" className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" placeholder="Amount in cents" inputMode="numeric" value={amountCents} onChange={(event) => setAmountCents(event.target.value)} />
          <button type="button" className="h-9 rounded-md bg-[var(--foreground)] px-4 text-sm font-medium text-[var(--background)] disabled:opacity-50" disabled={busy} onClick={() => void adjustBudget()}>Adjust budget</button>
        </div> : null}
      </section> : null}

      {canViewAudit ? <section className="mt-10" data-testid="admin-audit">
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
        </section> : null}</> : null}
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
