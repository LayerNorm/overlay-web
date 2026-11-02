'use client'

import { useEffect, useState } from 'react'
import {
  ListTree,
  LogOut,
  Moon,
  ScrollText,
  ShieldCheck,
  Sun,
  TrendingUp,
  UsersRound,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { BrandLockup, OverlayMark } from '@overlay/ui'
import { Button, IconButton } from '@overlay/ui/primitives'

import { AuthorizationAdminPanel } from '@/features/admin/authorization/AuthorizationAdminPanel'
import { CatalogPolicyAdminPanel } from '@/features/admin/catalog/CatalogPolicyAdminPanel'
import { GrowthPanel } from '@/features/admin/growth/GrowthPanel'
import { adminApi } from '@/shared/admin-api'
import type { AdminUsageRow, AdministrativeRole } from '@/shared/admin-types'
import { ADMIN_THEME_COOKIE, type AdminTheme } from './admin-theme'
import { AdminScreen } from './AdminScreen'
import { AuditPanel } from './audit/AuditPanel'
import { PeoplePanel } from './people/PeoplePanel'
import { initials } from './people/people-view'

type AdminSection = 'growth' | 'people' | 'audit' | 'roles' | 'groups' | 'catalog'

type NavItem = { value: AdminSection; label: string; Icon: LucideIcon }

export type AdminOperator = {
  name: string
  email: string
  role: AdministrativeRole
}

const ROLE_LABELS: Record<AdministrativeRole, string> = {
  admin: 'Admin',
  auditor: 'Auditor',
  billing_admin: 'Billing admin',
  support: 'Support',
}

function permissionsFor(capabilities: string[]) {
  const can = (capability: string) => capabilities.includes(capability)
  return {
    canViewUsage: can('usage.read') || can('support.access'),
    canViewAudit: can('audit.read'),
    // Growth is open to admin, auditor and billing roles (the server checks the role itself).
    canViewGrowth: can('audit.read') || can('usage.read'),
    canViewRoles: can('roles.read'),
    canManageRoles: can('roles.manage'),
    canViewGroups: can('groups.read'),
    canManageGroups: can('groups.manage'),
    canViewCatalog: can('roles.read'),
    canManageCatalog: can('roles.manage'),
  }
}

function navGroups(permissions: ReturnType<typeof permissionsFor>): { label: string; items: NavItem[] }[] {
  const groups = [
    {
      label: 'Insights',
      items: permissions.canViewGrowth ? [{ value: 'growth' as const, label: 'Growth', Icon: TrendingUp }] : [],
    },
    {
      label: 'Operations',
      items: [
        ...(permissions.canViewUsage ? [{ value: 'people' as const, label: 'People', Icon: UsersRound }] : []),
        ...(permissions.canViewAudit ? [{ value: 'audit' as const, label: 'Audit log', Icon: ScrollText }] : []),
      ],
    },
    {
      label: 'Access',
      items: [
        ...(permissions.canViewRoles ? [{ value: 'roles' as const, label: 'Roles', Icon: ShieldCheck }] : []),
        ...(permissions.canViewGroups ? [{ value: 'groups' as const, label: 'Groups', Icon: UserRound }] : []),
        ...(permissions.canViewCatalog ? [{ value: 'catalog' as const, label: 'Catalog', Icon: ListTree }] : []),
      ],
    },
  ]
  return groups.filter((group) => group.items.length > 0)
}

export function AdminConsolePage({
  capabilities,
  operator,
  theme: initialTheme,
}: {
  capabilities: string[]
  operator: AdminOperator
  theme: AdminTheme
}) {
  const permissions = permissionsFor(capabilities)
  const groups = navGroups(permissions)
  const available = groups.flatMap((group) => group.items.map((item) => item.value))
  const [selected, setSelected] = useState<AdminSection | null>(null)
  const section = selected && available.includes(selected) ? selected : available[0] ?? null
  const [directory, setDirectory] = useState<AdminUsageRow[]>([])
  const [theme, setTheme] = useState<AdminTheme>(initialTheme)

  // Roles and groups show people by email; load the directory once for them.
  const { canViewUsage } = permissions
  useEffect(() => {
    if (!canViewUsage) return
    const controller = new AbortController()
    adminApi.admin.listUsage({ limit: 200 }, { signal: controller.signal }).then(setDirectory).catch(() => undefined)
    return () => controller.abort()
  }, [canViewUsage])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    document.cookie = `${ADMIN_THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax; secure`
  }

  return (
    <div className="admin-shell" data-testid="admin-console">
      <aside className="admin-side">
        <div className="admin-side-head">
          <BrandLockup className="admin-lockup-full text-[17px] text-(--foreground)" />
          <OverlayMark className="admin-lockup-mark size-5 text-(--foreground)" />
          <span className="admin-tag">Admin</span>
        </div>
        <nav className="admin-side-body" aria-label="Administration sections">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="admin-nav-label">{group.label}</div>
              {group.items.map(({ value, label, Icon }) => (
                <Button
                  key={value}
                  variant="ghost"
                  className="admin-nav-row"
                  aria-label={label}
                  aria-current={section === value ? 'page' : undefined}
                  onClick={() => setSelected(value)}
                >
                  <Icon size={16} strokeWidth={1.6} className="shrink-0" />
                  <span className="admin-nav-text">{label}</span>
                </Button>
              ))}
            </div>
          ))}
        </nav>
        <div className="admin-side-foot">
          <div className="admin-me" title={operator.email}>
            <div className="admin-avatar" aria-hidden>{initials(operator.name, operator.email)}</div>
            <div className="min-w-0">
              <div className="admin-me-name">{operator.name}</div>
              <div className="admin-me-role">{ROLE_LABELS[operator.role]}</div>
            </div>
          </div>
          <IconButton
            className="admin-icon-btn"
            aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun size={16} strokeWidth={1.6} /> : <Moon size={16} strokeWidth={1.6} />}
          </IconButton>
          <Button asChild variant="ghost" size="icon" className="admin-icon-btn">
            <a href="/auth/sign-out" aria-label="Sign out" title="Sign out">
              <LogOut size={16} strokeWidth={1.6} />
            </a>
          </Button>
        </div>
      </aside>

      <main className="admin-main">
        {section === 'growth' ? <GrowthPanel /> : null}
        {section === 'people' ? <PeoplePanel /> : null}
        {section === 'audit' ? <AuditPanel /> : null}
        {section === 'roles' ? (
          <AdminScreen title="Roles" subtitle="What each role can do, and who has it">
            <AuthorizationAdminPanel
              canManage={permissions.canManageRoles}
              canManageRoles={permissions.canManageRoles}
              canReadRoles={permissions.canViewRoles}
              view="roles"
              userDirectory={directory}
            />
          </AdminScreen>
        ) : null}
        {section === 'groups' ? (
          <AdminScreen title="Groups" subtitle="People grouped for role assignment">
            <AuthorizationAdminPanel
              canManage={permissions.canManageGroups}
              canManageRoles={permissions.canManageRoles}
              canReadRoles={permissions.canViewRoles}
              view="groups"
              userDirectory={directory}
            />
          </AdminScreen>
        ) : null}
        {section === 'catalog' ? (
          <AdminScreen title="Catalog" subtitle="Models, tools and connectors people can use">
            <CatalogPolicyAdminPanel canManage={permissions.canManageCatalog} />
          </AdminScreen>
        ) : null}
        {section === null ? (
          <AdminScreen title="Administration">
            <div className="py-12" data-testid="admin-forbidden">
              <ShieldCheck size={22} />
              <h2 className="mt-4 text-lg font-semibold">Administrative access required</h2>
              <p className="admin-muted mt-2 text-sm">This account cannot view any administration section.</p>
            </div>
          </AdminScreen>
        ) : null}
      </main>
    </div>
  )
}
