'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Suspense } from 'react'
import type { ReactNode } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  Menu,
  ShieldCheck,
  User,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  FloatingMenu,
  SidebarNav,
  SidebarSection,
  SidebarShell,
  type SidebarResourceAction,
  type SidebarResourceSearch,
} from '@overlay/ui/primitives'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { OverlayMark } from '@/components/orb/Orb'
import { FilesInlinePanel } from '@/components/layout/AppSidebarInlinePanels'
import { AgentsInlinePanel } from '@/components/layout/AppSidebarAgentsPanel'
import { WorkInlinePanel } from '@/components/layout/sidebar/WorkInlinePanel'
import { SecondaryPanelContent } from './AppSidebarSecondaryPanel'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'
import type {
  AppSidebarChatPanelContext,
  AppSidebarNavigateContext,
  AppSidebarWorkspaceAdapter,
} from '../appSidebarTypes'
import type { AgentsPanelView } from '@/components/layout/sidebar-nav'
import type { MobileNavItemVm, SecondaryPanelKind, SidebarNavItem } from './appSidebarNav'

/** Default brand mark path. Custom brand configs keep rendering their image. */
const DEFAULT_BRAND_LOGO_SRC = '/assets/overlay-logo.png'

/**
 * Brand mark: the SVG Overlay orb by default, the configured raster image
 * only when a custom brand overrides the logo (white-label seam).
 */
function BrandMark({ logoSrc, logoAlt, size, className }: {
  logoSrc: string
  logoAlt?: string
  size: number
  className?: string
}) {
  if (logoSrc !== DEFAULT_BRAND_LOGO_SRC) {
    return <Image src={logoSrc} alt={logoAlt ?? ''} width={size} height={size} className={className} />
  }
  return (
    <span className={className} style={{ display: 'inline-flex' }}>
      <OverlayMark size={size} label={logoAlt || 'Overlay'} />
    </span>
  )
}

export function SidebarBrandLink({
  href,
  logoSrc,
  logoAlt,
  label,
  onNavigate,
  className,
  labelClassName,
}: {
  href: string
  logoSrc: string
  logoAlt?: string
  label: string
  onNavigate: () => void
  className: string
  labelClassName: string
}) {
  return (
    <Link href={href} className={className} onClick={onNavigate}>
      <BrandMark logoSrc={logoSrc} logoAlt={logoAlt} size={10} className="shrink-0" />
      <span className={labelClassName} style={{ fontFamily: 'var(--font-serif)' }}>
        {label}
      </span>
    </Link>
  )
}

export function SidebarRailBrand({
  collapsed,
  homeHref,
  logoSrc,
  logoAlt,
  label,
  onExpand,
  onCollapse,
}: {
  collapsed: boolean
  homeHref: string
  logoSrc: string
  logoAlt?: string
  label: string
  onExpand: () => void
  onCollapse: () => void
}) {
  if (collapsed) {
    // Collapsed, the rail is icon-only: the mark alone stands for the brand and
    // the wordmark returns with the expanded sidebar.
    return (
      <button
        type="button"
        onClick={onExpand}
        className="group inline-flex h-10 w-full items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-subtle)]"
        aria-label="Expand sidebar"
        title="Expand sidebar"
      >
        <BrandMark logoSrc={logoSrc} logoAlt={logoAlt} size={10} className="shrink-0 group-hover:hidden" />
        <ChevronRight size={16} className="hidden text-[var(--foreground)] group-hover:block" />
      </button>
    )
  }
  return (
    <>
      <Link
        href={homeHref}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5 transition-colors hover:bg-[var(--surface-subtle)]"
        aria-label="Home"
        title="Home"
      >
        <BrandMark logoSrc={logoSrc} logoAlt={logoAlt} size={10} className="shrink-0" />
        <span
          className="truncate text-lg font-medium tracking-tight text-[var(--foreground)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {label}
        </span>
      </Link>
      <button
        type="button"
        onClick={onCollapse}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        aria-label="Collapse sidebar"
        title="Collapse sidebar"
      >
        <ChevronLeft size={16} />
      </button>
    </>
  )
}

export function SecondaryPanelResourceList({
  panelKind,
  chatsView,
  agentsView,
  activeWorkspaceId,
  buildWorkspaceHref,
  chatPanelRefreshKey,
  renderChatPanel,
  renderAutomationsPanel,
  renderFilesPanel,
  renderAgentsPanel,
  onNavigate,
}: {
  panelKind: SecondaryPanelKind
  chatsView: string
  agentsView: AgentsPanelView
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string) => string
  chatPanelRefreshKey: number
  renderChatPanel?: (context: AppSidebarChatPanelContext) => ReactNode
  renderAutomationsPanel?: (context: AppSidebarNavigateContext) => ReactNode
  renderFilesPanel?: (context: AppSidebarNavigateContext) => ReactNode
  renderAgentsPanel?: (context: AppSidebarNavigateContext) => ReactNode
  onNavigate: () => void
}) {
  return (
    <Suspense fallback={<SidebarListSkeleton />}>
      {panelKind === 'chat' && renderChatPanel
        ? renderChatPanel({
          refreshKey: chatPanelRefreshKey,
          onNavigate,
          view: chatsView,
        })
        : null}
      {panelKind === 'files' || panelKind === 'notes' ? (
        renderFilesPanel
          ? renderFilesPanel({ onNavigate })
          : <FilesInlinePanel searchQuery="" onNavigate={onNavigate} />
      ) : null}
      {panelKind === 'work' ? (
        <WorkInlinePanel
          workspaceId={activeWorkspaceId}
          baseHref={activeWorkspaceId ? buildWorkspaceHref(activeWorkspaceId, '/app/work') : undefined}
          scope={agentsView}
          onNavigate={onNavigate}
        />
      ) : null}
      {panelKind === 'agents' ? (
        renderAgentsPanel
          ? renderAgentsPanel({ onNavigate })
          : <AgentsInlinePanel
            workspaceId={activeWorkspaceId}
            baseHref={activeWorkspaceId ? buildWorkspaceHref(activeWorkspaceId, '/app/agents') : undefined}
            view={agentsView}
            onNavigate={onNavigate}
          />
      ) : null}
      {panelKind === 'automations' && renderAutomationsPanel
        ? renderAutomationsPanel({ onNavigate })
        : null}
    </Suspense>
  )
}

export function DesktopAccountSlot({
  menuRef,
  isGuestConfirmed,
  workspace,
  railExpanded,
  displayName,
  accountMenuOpen,
  onAccountMenuOpenChange,
  accountMenu,
  onSignIn,
}: {
  menuRef: { current: HTMLDivElement | null }
  isGuestConfirmed: boolean
  workspace: AppSidebarWorkspaceAdapter | undefined
  railExpanded: boolean
  displayName: string
  accountMenuOpen: boolean
  onAccountMenuOpenChange: (open: boolean) => void
  accountMenu: ReactNode
  onSignIn: () => void
}) {
  return (
    <div ref={menuRef} className="relative">
      {!isGuestConfirmed && workspace ? (
        workspace.renderSwitcher?.({
          compact: !railExpanded,
          onNavigate: () => {
            onAccountMenuOpenChange(false)
          },
          placement: 'footer',
          userLabel: displayName,
          accountMenu,
        })
      ) : (
        <DesktopAccountFallback
          menuRef={menuRef}
          isGuestConfirmed={isGuestConfirmed}
          railExpanded={railExpanded}
          displayName={displayName}
          accountMenuOpen={accountMenuOpen}
          onAccountMenuOpenChange={onAccountMenuOpenChange}
          accountMenu={accountMenu}
          onSignIn={onSignIn}
        />
      )}
    </div>
  )
}

function DesktopAccountFallback({
  menuRef,
  isGuestConfirmed,
  railExpanded,
  displayName,
  accountMenuOpen,
  onAccountMenuOpenChange,
  accountMenu,
  onSignIn,
}: {
  menuRef: { current: HTMLDivElement | null }
  isGuestConfirmed: boolean
  railExpanded: boolean
  displayName: string
  accountMenuOpen: boolean
  onAccountMenuOpenChange: (open: boolean) => void
  accountMenu: ReactNode
  onSignIn: () => void
}) {
  const rowClass = `flex h-9 w-full items-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${
    railExpanded ? 'gap-2.5 px-3' : 'justify-center'
  }`
  const label = railExpanded ? (
    <span className="min-w-0 flex-1 truncate text-left text-sm">{displayName}</span>
  ) : null
  if (!isGuestConfirmed) {
    return (
      <>
        <FloatingMenu
          anchorRef={menuRef}
          open={accountMenuOpen}
          onOpenChange={onAccountMenuOpenChange}
          side="top"
          className="w-64"
        >
          {accountMenu}
        </FloatingMenu>
        <button
          type="button"
          onClick={() => onAccountMenuOpenChange(!accountMenuOpen)}
          className={rowClass}
          aria-label="Account menu"
          aria-expanded={accountMenuOpen}
          title={displayName}
        >
          <User size={15} className="shrink-0" />
          {label}
        </button>
      </>
    )
  }
  return (
    <button type="button" onClick={onSignIn} className={rowClass} aria-label="Sign in" title="Sign in">
      <User size={15} className="shrink-0" />
      {railExpanded ? <span className="min-w-0 flex-1 truncate text-left text-sm">Sign in</span> : null}
    </button>
  )
}

export function MobileTopBar({
  hidden,
  brandLink,
  isGuestConfirmed,
  workspace,
  displayName,
  mobileAccountOpen,
  onMobileAccountOpenChange,
  accountMenu,
  accountRef,
  onOpenMenu,
  onCloseMenu,
}: {
  hidden: boolean
  brandLink: ReactNode
  isGuestConfirmed: boolean
  workspace: AppSidebarWorkspaceAdapter | undefined
  displayName: string
  mobileAccountOpen: boolean
  onMobileAccountOpenChange: (open: boolean) => void
  accountMenu: ReactNode
  accountRef: { current: HTMLDivElement | null }
  onOpenMenu: () => void
  onCloseMenu: () => void
}) {
  return (
    <div className={`fixed inset-x-0 top-0 z-40 border-b border-[var(--border)] bg-[color:color-mix(in_srgb,var(--sidebar-surface)_95%,transparent)] backdrop-blur transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:hidden ${
      hidden ? 'pointer-events-none -translate-y-full opacity-0' : 'translate-y-0 opacity-100'
    }`}>
      <div className="flex h-14 items-center justify-between gap-2 px-3">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open app navigation"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]"
        >
          <Menu size={16} />
        </button>
        <div className="flex min-w-0 flex-1 justify-center px-1">{brandLink}</div>
        <div className="relative shrink-0" ref={accountRef}>
          {!isGuestConfirmed && workspace ? (
            <div className="max-w-[min(14rem,calc(100vw-7rem))]">
              {workspace.renderSwitcher?.({
                compact: true,
                placement: 'header',
                userLabel: displayName,
                onNavigate: () => {
                  onMobileAccountOpenChange(false)
                  onCloseMenu()
                },
                accountMenu,
              })}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onMobileAccountOpenChange(!mobileAccountOpen)}
                aria-label="Account menu"
                aria-expanded={mobileAccountOpen}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              >
                <User size={16} />
              </button>
              {mobileAccountOpen && (
                <div
                  className="overlay-pop-in absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  {accountMenu}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function MobileAccountFooter({
  menuRef,
  isGuestConfirmed,
  workspace,
  displayName,
  accountMenuOpen,
  onAccountMenuOpenChange,
  accountMenu,
  onNavigate,
  onSignIn,
}: {
  menuRef: { current: HTMLDivElement | null }
  isGuestConfirmed: boolean
  workspace: AppSidebarWorkspaceAdapter | undefined
  displayName: string
  accountMenuOpen: boolean
  onAccountMenuOpenChange: (open: boolean) => void
  accountMenu: ReactNode
  onNavigate: () => void
  onSignIn: () => void
}) {
  return (
    <SidebarSection className="space-y-3 px-3">
      <div ref={menuRef} className="relative">
        {!isGuestConfirmed && workspace ? (
          workspace.renderSwitcher?.({
            compact: false,
            onNavigate: () => {
              onAccountMenuOpenChange(false)
              onNavigate()
            },
            placement: 'footer',
            userLabel: displayName,
            accountMenu,
          })
        ) : !isGuestConfirmed ? (
          <>
            {accountMenuOpen ? (
              <div
                className="overlay-fade-in absolute bottom-full left-0 right-0 z-50 mb-1 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg"
                onMouseDown={(event) => event.stopPropagation()}
              >
                {accountMenu}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => onAccountMenuOpenChange(!accountMenuOpen)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              aria-label="Account menu"
            >
              <User size={13} />
              <span className="flex-1 truncate text-left">{displayName}</span>
              <ChevronUp size={11} className={`shrink-0 transition-transform ${accountMenuOpen ? '' : 'rotate-180'}`} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
            aria-label="Sign in"
          >
            <User size={13} />
            <span className="flex-1 text-left">Sign in</span>
          </button>
        )}
      </div>
    </SidebarSection>
  )
}

export function MobileNavRow({
  icon,
  label,
  disabled,
  active,
  pending,
  unreadCount,
  opensPanel,
  onSelect,
}: {
  icon: LucideIcon
  label: string
  disabled?: boolean
  active: boolean
  pending: boolean
  unreadCount: number
  opensPanel: boolean
  onSelect: () => void
}) {
  const Icon = icon
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      title={disabled ? 'Coming soon' : label}
      aria-label={disabled ? `${label} (coming soon)` : label}
      aria-current={active ? 'page' : undefined}
      className={`group flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed text-[var(--muted-light)]'
          : active
            ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
            : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
      }`}
    >
      <Icon size={15} />
      <div className="min-w-0 flex-1 text-left">{label}</div>
      <MobileNavRowAccessory pending={pending} unreadCount={unreadCount} opensPanel={opensPanel} disabled={disabled} />
    </button>
  )
}

function MobileNavRowAccessory({
  pending,
  unreadCount,
  opensPanel,
  disabled,
}: {
  pending: boolean
  unreadCount: number
  opensPanel: boolean
  disabled?: boolean
}) {
  if (pending) return <Loader2 size={14} className="shrink-0 animate-spin text-[var(--muted)]" aria-hidden />
  if (unreadCount > 0) {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--border)] text-[9px] font-medium text-[var(--foreground)]">
        {unreadCount > 9 ? '9+' : unreadCount}
      </span>
    )
  }
  if (opensPanel && !disabled) {
    return <ChevronRight size={13} className="shrink-0 text-[var(--muted-light)]" aria-hidden />
  }
  return null
}

export interface ShowcaseLink {
  id: string
  label: string
  icon: LucideIcon
  href: string
}

export function MobileNavStep({
  brandLink,
  onClose,
  showAdminNavigation,
  adminOpen,
  onAdminSelect,
  navItems,
  showcaseLinks,
  onShowcaseSelect,
  footer,
}: {
  brandLink: ReactNode
  onClose: () => void
  showAdminNavigation: boolean
  adminOpen: boolean
  onAdminSelect: () => void
  navItems: Array<{
    id: string
    icon: LucideIcon
    label: string
    disabled?: boolean
    active: boolean
    pending: boolean
    unreadCount: number
    opensPanel: boolean
    onSelect: () => void
  }>
  showcaseLinks: ShowcaseLink[]
  onShowcaseSelect: (link: ShowcaseLink) => void
  footer: ReactNode
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4">
        <div className="min-w-0 flex-1">
          {brandLink}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close app navigation"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <SidebarNav className="min-h-0 flex-1 overflow-y-auto">
          {showAdminNavigation ? (
            <button
              type="button"
              onClick={onAdminSelect}
              aria-label="Admin"
              aria-current={adminOpen ? 'page' : undefined}
              className={`group flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm transition-colors ${
                adminOpen
                  ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
              }`}
            >
              <ShieldCheck size={15} />
              <div className="min-w-0 flex-1 text-left">Admin</div>
            </button>
          ) : null}
          {navItems.map((item) => (
            <MobileNavRow
              key={item.id}
              icon={item.icon}
              label={item.label}
              disabled={item.disabled}
              active={item.active}
              pending={item.pending}
              unreadCount={item.unreadCount}
              opensPanel={item.opensPanel}
              onSelect={item.onSelect}
            />
          ))}
          {showcaseLinks.length ? (
            <div className="mt-0.5 border-t border-[var(--border)] pt-1">
              {showcaseLinks.map((link) => {
                const Icon = link.icon
                return (
                  <button
                    key={link.id}
                    type="button"
                    onClick={() => onShowcaseSelect(link)}
                    aria-label={link.label}
                    className="group flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                  >
                    <Icon size={15} />
                    <div className="min-w-0 flex-1 text-left">{link.label}</div>
                  </button>
                )
              })}
            </div>
          ) : null}
        </SidebarNav>
        {footer}
      </div>
    </>
  )
}

export function MobilePanelStep({
  panelTitle,
  onBack,
  onClose,
  nav,
  action,
  search,
  children,
}: {
  panelTitle: string
  onBack: () => void
  onClose: () => void
  nav?: SecondaryPanelNav
  action?: SidebarResourceAction | null
  search?: SidebarResourceSearch | null
  children?: ReactNode
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--border)] px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to app navigation"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        >
          <ChevronLeft size={16} />
        </button>
        <span
          className="min-w-0 flex-1 truncate px-1 text-lg font-medium lowercase tracking-tight text-[var(--foreground)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {panelTitle}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close app navigation"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]"
        >
          <X size={16} />
        </button>
      </div>
      <SecondaryPanelContent nav={nav} action={action} search={search}>
        {children}
      </SecondaryPanelContent>
    </>
  )
}

export function MobileSidebar({
  open,
  hidden,
  onClose,
  view,
  showPanel,
  onBack,
  panelTitle,
  panelNav,
  panelAction,
  panelSearch,
  panelChildren,
  brandLink,
  showAdminNavigation,
  adminOpen,
  onAdminSelect,
  navItems,
  onSelectItem,
  showcaseLinks,
  menuRef,
  isGuestConfirmed,
  workspace,
  displayName,
  accountMenuOpen,
  onAccountMenuOpenChange,
  accountMenu,
  onSignIn,
}: {
  open: boolean
  hidden: boolean
  onClose: () => void
  view: 'nav' | 'panel'
  showPanel: boolean
  onBack: () => void
  panelTitle: string
  panelNav?: SecondaryPanelNav
  panelAction?: SidebarResourceAction | null
  panelSearch?: SidebarResourceSearch | null
  panelChildren?: ReactNode
  brandLink: ReactNode
  showAdminNavigation: boolean
  adminOpen: boolean
  onAdminSelect: () => void
  navItems: MobileNavItemVm[]
  onSelectItem: (item: SidebarNavItem) => void
  showcaseLinks: ShowcaseLink[]
  menuRef: { current: HTMLDivElement | null }
  isGuestConfirmed: boolean
  workspace: AppSidebarWorkspaceAdapter | undefined
  displayName: string
  accountMenuOpen: boolean
  onAccountMenuOpenChange: (open: boolean) => void
  accountMenu: ReactNode
  onSignIn: () => void
}) {
  const router = useRouter()
  return (
    <MobileDrawer open={open} hidden={hidden} onClose={onClose}>
      {view === 'panel' && showPanel ? (
        <MobilePanelStep
          panelTitle={panelTitle}
          onBack={onBack}
          onClose={onClose}
          nav={panelNav}
          action={panelAction}
          search={panelSearch}
        >
          {panelChildren}
        </MobilePanelStep>
      ) : (
        <MobileNavStep
          brandLink={brandLink}
          onClose={onClose}
          showAdminNavigation={showAdminNavigation}
          adminOpen={adminOpen}
          onAdminSelect={onAdminSelect}
          navItems={navItems.map((vm) => ({
            id: vm.item.id,
            icon: vm.item.icon,
            label: vm.item.label,
            disabled: vm.item.disabled,
            active: vm.active,
            pending: vm.pending,
            unreadCount: vm.unreadCount,
            opensPanel: vm.opensPanel,
            onSelect: () => onSelectItem(vm.item),
          }))}
          showcaseLinks={showcaseLinks}
          onShowcaseSelect={(link) => {
            if (/^https?:\/\//.test(link.href)) window.location.assign(link.href)
            else router.push(link.href)
            onClose()
          }}
          footer={
            <MobileAccountFooter
              menuRef={menuRef}
              isGuestConfirmed={isGuestConfirmed}
              workspace={workspace}
              displayName={displayName}
              accountMenuOpen={accountMenuOpen}
              onAccountMenuOpenChange={onAccountMenuOpenChange}
              accountMenu={accountMenu}
              onNavigate={onClose}
              onSignIn={onSignIn}
            />
          }
        />
      )}
    </MobileDrawer>
  )
}

export function MobileDrawer({
  open,
  hidden,
  onClose,
  children,
}: {
  open: boolean
  hidden: boolean
  onClose: () => void
  children?: ReactNode
}) {
  const visible = open && !hidden
  return (
    <div className={`fixed inset-0 z-50 md:hidden ${visible ? '' : 'pointer-events-none'}`}>
      <button
        type="button"
        aria-label="Close app navigation"
        onClick={onClose}
        className={`absolute inset-0 bg-black/30 transition-opacity ${visible ? 'opacity-100' : 'opacity-0'}`}
      />
      <SidebarShell
        className={`absolute inset-y-0 left-0 w-[82vw] max-w-[320px] border-r border-[var(--border)] bg-[var(--sidebar-surface)] shadow-[0_20px_80px_rgba(10,10,10,0.18)] transition-transform ${
          visible ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {children}
      </SidebarShell>
    </div>
  )
}
