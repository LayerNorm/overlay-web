'use client'
import { unstyledButton } from '../../control-reset'
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
  User,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FloatingMenu, SidebarNav, SidebarSection, Sheet, SheetContent, SheetTitle, SidebarShell, type SidebarResourceAction, type SidebarResourceSearch, Button } from '@overlay/ui/primitives'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { OverlayMark } from '@/components/orb/Orb'
import { FilesInlinePanel } from '@/components/layout/AppSidebarInlinePanels'
import { AgentsInlinePanel } from '@/components/layout/AppSidebarAgentsPanel'
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
      <Button variant="ghost"
        type="button"
        onClick={onExpand}
        className={unstyledButton("group inline-flex h-10 w-full items-center justify-center rounded-md transition-colors hover:bg-(--surface-subtle)")}
        aria-label="Expand sidebar"
        title="Expand sidebar"
      >
        <BrandMark logoSrc={logoSrc} logoAlt={logoAlt} size={10} className="shrink-0 group-hover:hidden" />
        <ChevronRight size={16} className="hidden text-(--foreground) group-hover:block" />
      </Button>
    )
  }
  return (
    <>
      <Link
        href={homeHref}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5 transition-colors hover:bg-(--surface-subtle)"
        aria-label="Home"
        title="Home"
      >
        <BrandMark logoSrc={logoSrc} logoAlt={logoAlt} size={10} className="shrink-0" />
        <span
          className="truncate text-lg font-medium tracking-tight text-(--foreground)"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {label}
        </span>
      </Link>
      <Button variant="ghost"
        type="button"
        onClick={onCollapse}
        className={unstyledButton("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)")}
        aria-label="Collapse sidebar"
        title="Collapse sidebar"
      >
        <ChevronLeft size={16} />
      </Button>
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
  const rowClass = `flex h-9 w-full items-center rounded-md text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) ${
    railExpanded ? 'gap-2.5 px-3' : 'justify-center'
  }`
  const label = railExpanded ? (
    <span className="min-w-0 flex-1 truncate text-left text-sm">{displayName}</span>
  ) : null
  if (!isGuestConfirmed) {
    return (
      <>
        <FloatingMenu
          aria-label="Account"
          trigger={
            <Button variant="ghost"
              type="button"
              className={unstyledButton(rowClass)}
              aria-label="Account menu"
              aria-expanded={accountMenuOpen}
              title={displayName}
            >
              <User size={15} className="shrink-0" />
              {label}
            </Button>
          }
          anchorRef={menuRef}
          open={accountMenuOpen}
          onOpenChange={onAccountMenuOpenChange}
          side="top"
          className="w-64"
        >
          {accountMenu}
        </FloatingMenu>
      </>
    )
  }
  return (
    <Button variant="ghost"
      type="button"
      onClick={onSignIn}
      className={unstyledButton(rowClass)}
      aria-label="Sign in"
      title="Sign in"
    >
      <User size={15} className="shrink-0" />
      {railExpanded ? (
        <span className="min-w-0 flex-1 truncate text-left text-sm">Sign in</span>
      ) : null}
    </Button>
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
    <div
      className={`fixed inset-x-0 top-0 z-40 border-b border-(--border) bg-[color-mix(in_srgb,var(--sidebar-surface)_95%,transparent)] backdrop-blur-sm transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:hidden ${
        hidden ? 'pointer-events-none -translate-y-full opacity-0' : 'translate-y-0 opacity-100'
      }`}
    >
      <div className="flex h-14 items-center justify-between gap-2 px-3">
        <Button variant="ghost"
          type="button"
          onClick={onOpenMenu}
          aria-label="Open app navigation"
          className={unstyledButton("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-(--border) bg-(--surface-elevated) text-(--muted)")}
        >
          <Menu size={16} />
        </Button>
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
            <FloatingMenu
              anchorRef={accountRef}
              trigger={
                <Button variant="ghost"
                  type="button"
                  aria-label="Account menu"
                  aria-expanded={mobileAccountOpen}
                  className={unstyledButton("inline-flex h-9 w-9 items-center justify-center rounded-full border border-(--border) bg-(--surface-elevated) text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)")}
                >
                  <User size={16} />
                </Button>
              }
              open={mobileAccountOpen}
              onOpenChange={onMobileAccountOpenChange}
              align="end"
              aria-label="Account"
              className="w-60 rounded-lg"
            >
              {accountMenu}
            </FloatingMenu>
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
          <FloatingMenu
            anchorRef={menuRef}
            trigger={
              <Button variant="ghost"
                type="button"
                className={unstyledButton("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)")}
                aria-label="Account menu"
              >
                <User size={13} />
                <span className="flex-1 truncate text-left">{displayName}</span>
                <ChevronUp
                  size={11}
                  className={`shrink-0 transition-transform ${accountMenuOpen ? '' : 'rotate-180'}`}
                />
              </Button>
            }
            open={accountMenuOpen}
            onOpenChange={onAccountMenuOpenChange}
            side="top"
            aria-label="Account"
            className="w-64 rounded-lg"
          >
            {accountMenu}
          </FloatingMenu>
        ) : (
          <Button variant="ghost"
            type="button"
            onClick={onSignIn}
            className={unstyledButton("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)")}
            aria-label="Sign in"
          >
            <User size={13} />
            <span className="flex-1 text-left">Sign in</span>
          </Button>
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
    <Button variant="ghost"
      type="button"
      disabled={disabled}
      onClick={onSelect}
      title={disabled ? 'Coming soon' : label}
      aria-label={disabled ? `${label} (coming soon)` : label}
      aria-current={active ? 'page' : undefined}
      className={unstyledButton(`group flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed text-(--muted-light)'
          : active
            ? 'bg-(--surface-subtle) text-(--foreground)'
            : 'text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)'
      }`)}
    >
      <Icon size={15} />
      <div className="min-w-0 flex-1 text-left">{label}</div>
      <MobileNavRowAccessory pending={pending} unreadCount={unreadCount} opensPanel={opensPanel} disabled={disabled} />
    </Button>
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
  if (pending) return <Loader2 size={14} className="shrink-0 animate-spin text-(--muted)" aria-hidden />
  if (unreadCount > 0) {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-(--border) text-[9px] font-medium text-(--foreground)">
        {unreadCount > 9 ? '9+' : unreadCount}
      </span>
    )
  }
  if (opensPanel && !disabled) {
    return <ChevronRight size={13} className="shrink-0 text-(--muted-light)" aria-hidden />
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
  navItems,
  showcaseLinks,
  onShowcaseSelect,
  footer,
}: {
  brandLink: ReactNode
  onClose: () => void
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
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-(--border) px-4">
        <div className="min-w-0 flex-1">
          {brandLink}
        </div>
        <Button variant="ghost"
          type="button"
          onClick={onClose}
          aria-label="Close app navigation"
          className={unstyledButton("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-(--border) bg-(--surface-elevated) text-(--muted)")}
        >
          <X size={16} />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <SidebarNav className="min-h-0 flex-1 overflow-y-auto">
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
            <div className="mt-0.5 border-t border-(--border) pt-1">
              {showcaseLinks.map((link) => {
                const Icon = link.icon
                return (
                  <Button variant="ghost"
                    key={link.id}
                    type="button"
                    onClick={() => onShowcaseSelect(link)}
                    aria-label={link.label}
                    className={unstyledButton("group flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)")}
                  >
                    <Icon size={15} />
                    <div className="min-w-0 flex-1 text-left">{link.label}</div>
                  </Button>
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
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-(--border) px-2">
        <Button variant="ghost"
          type="button"
          onClick={onBack}
          aria-label="Back to app navigation"
          className={unstyledButton("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)")}
        >
          <ChevronLeft size={16} />
        </Button>
        <span
          className="min-w-0 flex-1 truncate px-1 text-lg font-medium lowercase tracking-tight text-(--foreground)"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {panelTitle}
        </span>
        <Button variant="ghost"
          type="button"
          onClick={onClose}
          aria-label="Close app navigation"
          className={unstyledButton("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-(--border) bg-(--surface-elevated) text-(--muted)")}
        >
          <X size={16} />
        </Button>
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
  return (
    <Sheet open={open && !hidden} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <SheetContent
        side="left"
        showCloseButton={false}
        overlayClassName="z-50 bg-black/30 md:hidden"
        className="z-50 w-[82vw] max-w-[320px] gap-0 border-r border-(--border) bg-(--sidebar-surface) p-0 shadow-[0_20px_80px_rgba(10,10,10,0.18)] md:hidden"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">App navigation</SheetTitle>
        <SidebarShell className="h-full">{children}</SidebarShell>
      </SheetContent>
    </Sheet>
  )
}
