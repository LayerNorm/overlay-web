'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  LayoutDashboard,
  ListTree,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { AdminShell } from '@/components/AdminShell'
import { AuthorizationAdminPanel } from '@/features/admin/authorization/AuthorizationAdminPanel'
import { CatalogPolicyAdminPanel } from '@/features/admin/catalog/CatalogPolicyAdminPanel'

type UsageRow = {
  userId: string
  email?: string
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

type AdminSection = 'overview' | 'roles' | 'groups' | 'catalog'

type AdminSectionOption = {
  value: AdminSection
  label: string
  Icon: LucideIcon
}

type AdminPermissions = {
  canViewUsage: boolean
  canViewAudit: boolean
  canViewRoles: boolean
  canManageRoles: boolean
  canViewGroups: boolean
  canManageGroups: boolean
  canViewCatalog: boolean
  canManageCatalog: boolean
}

function useAdminSections({
  canViewUsage,
  canViewAudit,
  canViewRoles,
  canViewGroups,
  canViewCatalog,
}: AdminPermissions) {
  const [section, setSection] = useState<AdminSection>('overview')
  const sections: AdminSectionOption[] = [
    ...(canViewUsage || canViewAudit ? [{ value: 'overview' as const, label: 'Overview', Icon: LayoutDashboard }] : []),
    ...(canViewRoles ? [{ value: 'roles' as const, label: 'Roles', Icon: ShieldCheck }] : []),
    ...(canViewGroups ? [{ value: 'groups' as const, label: 'Groups', Icon: UsersRound }] : []),
    ...(canViewCatalog ? [{ value: 'catalog' as const, label: 'Catalog', Icon: ListTree }] : []),
  ]
  return { section, setSection, sections }
}

function useAdminData({ canViewUsage, canViewAudit }: AdminPermissions) {
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [events, setEvents] = useState<AuditRow[]>([])
  const [userFilter, setUserFilter] = useState('')
  const [auditFilter, setAuditFilter] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    if (usageResponse && !usageResponse.ok) throw new Error('Failed to load people')
    if (auditResponse && !auditResponse.ok) throw new Error('Failed to load audit data')
    setForbidden(false)
    setUsage(
      usageResponse
        ? ((await usageResponse.json()) as { usage: UsageRow[] }).usage
        : [],
    )
    setEvents(
      auditResponse
        ? ((await auditResponse.json()) as { events: AuditRow[] }).events
        : [],
    )
  }, [auditFilter, canViewAudit, canViewUsage, userFilter])

  return {
    usage,
    events,
    userFilter,
    setUserFilter,
    auditFilter,
    setAuditFilter,
    forbidden,
    error,
    setError,
    load,
  }
}

function AdminSidebarNav({
  sections,
  section,
  onSelectSection,
}: {
  sections: AdminSectionOption[]
  section: AdminSection
  onSelectSection: (section: AdminSection) => void
}) {
  return (
    <nav aria-label="Administration sections" className="space-y-0.5 px-2 py-3">
      {sections.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-current={section === value ? 'page' : undefined}
          onClick={() => onSelectSection(value)}
          className={`flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm transition-colors max-sm:justify-center max-sm:px-0 ${
            section === value
              ? 'bg-(--surface-subtle) text-(--foreground)'
              : 'text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)'
          }`}
        >
          <Icon size={15} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate max-sm:hidden">{label}</span>
        </button>
      ))}
    </nav>
  )
}

function AdminUsageSection({
  usage,
  userFilter,
  onUserFilterChange,
  onApplyFilter,
}: {
  usage: UsageRow[]
  userFilter: string
  onUserFilterChange: (value: string) => void
  onApplyFilter: () => void
}) {
  return (
    <section data-testid="admin-usage">
      <div className="flex items-center gap-2"><UsersRound size={17} /><h2 className="text-sm font-semibold">People</h2></div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 text-(--muted)" size={15} />
          <input aria-label="Filter people by user ID" className="h-9 w-full rounded-md border border-(--border) bg-(--surface) pl-9 pr-3 text-sm" placeholder="User ID" value={userFilter} onChange={(event) => onUserFilterChange(event.target.value)} />
        </div>
        <button type="button" className="h-9 rounded-md border border-(--border) px-4 text-sm" onClick={onApplyFilter}>Apply filter</button>
      </div>
      <div className="mt-4 divide-y divide-(--border) border-y border-(--border)">
        {usage.map((row) => (
          <div key={row.userId} className="py-3 text-sm">
            <div className="font-medium">{row.email || row.userId}</div>
            <div className="text-xs text-(--muted)">{row.userId}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function AdminAuditSection({
  events,
  auditFilter,
  onAuditFilterChange,
  onSearch,
}: {
  events: AuditRow[]
  auditFilter: string
  onAuditFilterChange: (value: string) => void
  onSearch: () => void
}) {
  return (
    <section className="mt-10" data-testid="admin-audit">
      <div className="flex items-center gap-2"><ShieldCheck size={17} /><h2 className="text-sm font-semibold">Audit events</h2></div>
      <div className="mt-4 flex gap-3">
        <input aria-label="Filter audit action" className="h-9 min-w-0 flex-1 rounded-md border border-(--border) bg-(--surface) px-3 text-sm" placeholder="Exact action" value={auditFilter} onChange={(event) => onAuditFilterChange(event.target.value)} />
        <button type="button" className="h-9 rounded-md border border-(--border) px-4 text-sm" onClick={onSearch}>Search</button>
      </div>
      <div className="mt-4 divide-y divide-(--border) border-y border-(--border)">
        {events.length === 0 ? <p className="py-5 text-sm text-(--muted)">No matching audit events.</p> : events.map((event) => (
          <div key={event.id} className="grid gap-1 py-3 text-sm md:grid-cols-[220px_1fr_100px]">
            <div><p className="font-medium">{event.action}</p><p className="text-xs text-(--muted)">{
              // Locale pinned to 'en-US'.
              new Date(event.createdAt).toLocaleString('en-US')
            }</p></div>
            <p className="text-(--muted)">{event.resourceType}{event.resourceId ? ` · ${event.resourceId}` : ''}</p>
            <p>{event.outcome}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function AdminOverview({
  forbidden,
  canViewUsage,
  canViewAudit,
  usageSection,
  auditSection,
}: {
  forbidden: boolean
  canViewUsage: boolean
  canViewAudit: boolean
  usageSection: ReactNode
  auditSection: ReactNode
}) {
  if (forbidden || (!canViewUsage && !canViewAudit)) {
    return (
      <div className="py-12" data-testid="admin-forbidden">
        <ShieldCheck size={22} />
        <h2 className="mt-4 text-lg font-semibold">Administrative access required</h2>
        <p className="mt-2 text-sm text-(--muted)">This account cannot view people or audit data.</p>
      </div>
    )
  }
  return (
    <>
      {canViewUsage ? usageSection : null}
      {canViewAudit ? auditSection : null}
    </>
  )
}

export function AdminConsole({
  email,
  userId,
  role,
  capabilities,
}: {
  email: string
  userId: string
  role: string
  capabilities: string[]
}) {
  const can = useCallback(
    (capability: string) => capabilities.includes(capability),
    [capabilities],
  )
  const permissions: AdminPermissions = {
    canViewUsage: can('usage.read'),
    canViewAudit: can('audit.read'),
    canViewRoles: can('roles.read'),
    canManageRoles: can('roles.manage'),
    canViewGroups: can('groups.read'),
    canManageGroups: can('groups.manage'),
    canViewCatalog: can('roles.read'),
    canManageCatalog: can('roles.manage'),
  }
  const { canViewRoles, canManageRoles, canViewGroups, canManageGroups, canViewCatalog, canManageCatalog } = permissions
  const { section, setSection, sections } = useAdminSections(permissions)
  const {
    usage,
    events,
    userFilter,
    setUserFilter,
    auditFilter,
    setAuditFilter,
    forbidden,
    error,
    setError,
    load,
  } = useAdminData(permissions)

  useEffect(() => {
    void load().catch((loadError) => setError(message(loadError)))
  }, [load, setError])

  useEffect(() => {
    if (section === 'overview' && (permissions.canViewUsage || permissions.canViewAudit)) return
    if (section === 'roles' && canViewRoles) return
    if (section === 'groups' && canViewGroups) return
    if (section === 'catalog' && canViewCatalog) return
    if (permissions.canViewUsage || permissions.canViewAudit) setSection('overview')
    else if (canViewRoles) setSection('roles')
    else if (canViewGroups) setSection('groups')
    else if (canViewCatalog) setSection('catalog')
  }, [canViewCatalog, canViewGroups, canViewRoles, permissions.canViewAudit, permissions.canViewUsage, section, setSection])

  return (
    <AdminShell
      email={email}
      nav={<AdminSidebarNav sections={sections} section={section} onSelectSection={setSection} />}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold capitalize">{section}</h2>
          <p className="mt-0.5 text-xs text-(--muted)">
            Signed in as {email} · role {role} · {userId}
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh administration"
          className="inline-flex size-8 items-center justify-center rounded-md text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)"
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {error ? (
        <p className='mb-5 text-sm text-red-600 dark:text-red-400'>{error}</p>
      ) : null}

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
      {section === 'catalog' && canViewCatalog ? (
        <CatalogPolicyAdminPanel canManage={canManageCatalog} />
      ) : null}

      {section === 'overview' ? (
        <AdminOverview
          forbidden={forbidden}
          canViewUsage={permissions.canViewUsage}
          canViewAudit={permissions.canViewAudit}
          usageSection={(
            <AdminUsageSection
              usage={usage}
              userFilter={userFilter}
              onUserFilterChange={setUserFilter}
              onApplyFilter={() => void load()}
            />
          )}
          auditSection={(
            <AdminAuditSection
              events={events}
              auditFilter={auditFilter}
              onAuditFilterChange={setAuditFilter}
              onSearch={() => void load()}
            />
          )}
        />
      ) : null}
    </AdminShell>
  )
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Administration request failed'
}
