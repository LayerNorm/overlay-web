'use client'

import NextLink from 'next/link'
import dynamic from 'next/dynamic'
import { CircleHelp, Moon, Settings, Sun } from 'lucide-react'
import { CollapsibleSection } from '@overlay/ui/primitives'
import { ShellAdapterProvider, SidebarAccountAvatar, SidebarAccountMenu, SidebarAccountProfile, type PrimaryRailItem, type ShellAdapter } from '@overlay/shell-react'
import { StorageBar, UsageBar } from './sidebar/SidebarUsageMeters'
import {
  DesktopAccountSlot,
  MobileDrawer,
  SelectedSidebar,
  MobileTopBar,
  SecondaryPanelResourceList,
  SidebarBrandLink,
} from './sidebar/AppSidebarChrome'
import { signOutToLanding } from './sidebar/appSidebarNav'
import { rememberPanelScope } from '@/hooks/use-panel-scope'
import { useOptionalAppSettings } from '@/components/providers/AppSettingsProvider'
import { useAppSidebarState } from './sidebar/useAppSidebarState'
import { EMPTY_COLLABORATION_NOTIFICATIONS, type AppSidebarProps } from './appSidebarTypes'
import { WORK_FILTER_LABELS, type WorkFilter } from '@/shared/work/query'
import type { InlineNavItem } from '@overlay/shell-react'
import { MARKETING_DOCS_URL } from '@/shared/marketing/marketing'

const GlobalSearchDialog = dynamic(() => import('./GlobalSearchDialog').then((mod) => ({ default: mod.GlobalSearchDialog })))
const WORK_SECTION_ORDER: readonly WorkFilter[] = ['needs-you', 'mine', 'all']
const WORK_SECTION_ROWS: ReadonlyArray<InlineNavItem> = WORK_SECTION_ORDER.map((id) => ({ id, label: WORK_FILTER_LABELS[id] }))
const shellAdapter = { Link: NextLink, rememberScope: rememberPanelScope } satisfies ShellAdapter

function renderAccountProfile(
  { user, displayName }: Pick<ReturnType<typeof useAppSidebarState>, 'user' | 'displayName'>,
  onAccountClick: () => void,
) {
  if (!user) return null
  return (
    <SidebarAccountProfile
      name={displayName}
      email={user.email}
      photoUrl={user.profilePictureUrl}
      onAccountClick={onAccountClick}
    />
  )
}

function resolveMobileSidebarProps({
  classicLayout,
  railItems,
  classicFooterItems,
  unifiedFooterItems,
  closeMobileDrawer,
}: {
  classicLayout: boolean
  railItems: PrimaryRailItem[]
  classicFooterItems: PrimaryRailItem[]
  unifiedFooterItems: PrimaryRailItem[] | undefined
  closeMobileDrawer: () => void
}) {
  const closeAfterSelect = (item: PrimaryRailItem) => ({
    ...item,
    onSelect: () => {
      closeMobileDrawer()
      item.onSelect()
    },
  })
  if (classicLayout) {
    return {
      drawerClassName: 'w-[calc(100vw-1rem)] max-w-[340px]',
      items: railItems,
      footerItems: classicFooterItems,
    }
  }
  return {
    drawerClassName: undefined,
    items: railItems.map(closeAfterSelect),
    footerItems: unifiedFooterItems?.map(closeAfterSelect),
  }
}

export type {
  AppSidebarChatPanelContext,
  AppSidebarNavigateContext,
  AppSidebarProps,
  AppSidebarWorkspaceAdapter,
} from './appSidebarTypes'

export default function AppSidebar({
  collaborationNotifications = EMPTY_COLLABORATION_NOTIFICATIONS,

  renderChatPanel,
  renderAutomationsPanel,
  renderFilesPanel,
  renderAgentsPanel,
  renderWorkSection,
  workspace,
}: AppSidebarProps) {
  const s = useAppSidebarState({
    collaborationNotifications,

    workspace,
  })
  const appSettings = useOptionalAppSettings()
  const classicLayout = appSettings?.settings.useSecondarySidebar !== false
  const railExpanded = !classicLayout && !s.sidebarCollapsed
  const brandHomeHref = s.brandConfig.homeHref
  const brandLabel = s.brandConfig.shortName ?? s.brandConfig.name

  const brandLink = (
    <SidebarBrandLink
      href={brandHomeHref}
      logoSrc={s.brandConfig.logoSrc}
      logoAlt={s.brandConfig.logoAlt}
      label={brandLabel}
      onNavigate={s.closeMobileDrawer}
      className="flex min-w-0 items-center gap-2"
      labelClassName="truncate text-xl font-medium tracking-tight"
    />
  )

  const usageMeters = s.billingEnabled ? (
    <>
      <CollapsibleSection label="Usage">
        <div className="px-3 pb-1">
          <UsageBar entitlements={s.entitlements} />
        </div>
      </CollapsibleSection>
      <CollapsibleSection label="Storage" className="border-t border-(--border)">
        <div className="px-3 pb-1">
          <StorageBar entitlements={s.entitlements} />
        </div>
      </CollapsibleSection>
    </>
  ) : null
  const accountMenuProps = { usageMeters }
  const closeMobileAccountMenus = () => {
    s.setMobileAccountOpen(false)
    s.closeAccountMenus()
    s.closeMobileDrawer()
  }
  const accountHeader = renderAccountProfile(s, s.closeAccountMenus)
  const mobileAccountHeader = renderAccountProfile(s, closeMobileAccountMenus)
  const userAvatar = s.user ? (
    <SidebarAccountAvatar name={s.displayName} photoUrl={s.user.profilePictureUrl} />
  ) : null
  const accountMenuContent = (
    <SidebarAccountMenu
      {...accountMenuProps}
      onSignOut={() => {
        s.closeAccountMenus()
        void signOutToLanding()
      }}
    />
  )
  const mobileAccountMenu = (
    <SidebarAccountMenu
      {...accountMenuProps}
      itemPaddingClass="py-2.5"
      onSignOut={() => {
        closeMobileAccountMenus()
        void signOutToLanding()
      }}
    />
  )

  const desktopAccountSlot = (
    <DesktopAccountSlot
      menuRef={s.menuRef}
      isGuestConfirmed={s.isGuestConfirmed}
      workspace={workspace}
      railExpanded={railExpanded}
      displayName={s.displayName}
      accountMenuOpen={s.accountMenuOpen}
      onAccountMenuOpenChange={s.setAccountMenuOpen}
      accountHeader={accountHeader}
      accountMenu={accountMenuContent}
      userAvatar={userAvatar}
      onSignIn={() => s.requireAuth('send')}
    />
  )
  const mobileAccountSlot = (
    <DesktopAccountSlot
      menuRef={s.mobileMenuRef}
      isGuestConfirmed={s.isGuestConfirmed}
      workspace={workspace}
      railExpanded={!classicLayout}
      displayName={s.displayName}
      accountMenuOpen={s.accountMenuOpen}
      onAccountMenuOpenChange={s.setAccountMenuOpen}
      accountHeader={mobileAccountHeader}
      accountMenu={mobileAccountMenu}
      userAvatar={userAvatar}
      onSignIn={() => s.requireAuth('send')}
    />
  )

  const panelChildren = s.routeState.hasResourcePanel && s.routeState.panelKind ? (
    <SecondaryPanelResourceList
      panelKind={s.routeState.panelKind}
      chatsView={s.routeState.chatsView}
      agentsView={s.routeState.agentsView}
      activeWorkspaceId={s.activeWorkspaceId}
      buildWorkspaceHref={s.buildWorkspaceHref}
      renderChatPanel={renderChatPanel}
      renderAutomationsPanel={renderAutomationsPanel}
      renderFilesPanel={renderFilesPanel}
      renderAgentsPanel={renderAgentsPanel}
      onNavigate={s.closeMobileDrawer}
    />
  ) : null
  const renderChatSection = s.routeState.hasResourcePanel && s.routeState.panelKind === 'chat'
    ? (view: string) => (
      <SecondaryPanelResourceList
        panelKind="chat"
        chatsView={view}
        section
        agentsView={s.routeState.agentsView}
        activeWorkspaceId={s.activeWorkspaceId}
        buildWorkspaceHref={s.buildWorkspaceHref}
        renderChatPanel={renderChatPanel}
        onNavigate={s.closeMobileDrawer}
      />
    )
    : undefined
  const workSections = s.routeState.panelKind === 'work' && renderWorkSection
  const renderSection = workSections
    ? (filter: string) => renderWorkSection({ filter, onNavigate: s.closeMobileDrawer })
    : renderChatSection
  const sectionRows = workSections ? WORK_SECTION_ROWS : undefined
  const sectionActions = workSections ? { all: s.panelAction } : s.panelSectionActions
  const settingsHref = s.activeWorkspaceId
    ? s.buildWorkspaceHref(s.activeWorkspaceId, '/app/settings')
    : '/app/settings'
  const railFooterItems: PrimaryRailItem[] = [
    ...(appSettings ? [{
      id: 'theme', label: appSettings.settings.theme === 'dark' ? 'Use light theme' : 'Use dark theme',
      icon: appSettings.settings.theme === 'dark' ? Sun : Moon,
      onSelect: () => { void appSettings.updateSettings({ theme: appSettings.settings.theme === 'dark' ? 'light' : 'dark' }) },
    }] : []),
    { id: 'help', label: 'Help', icon: CircleHelp, href: `${MARKETING_DOCS_URL}/help`, onSelect: () => { window.open(`${MARKETING_DOCS_URL}/help`, '_blank', 'noopener,noreferrer') } },
    { id: 'settings', label: 'Settings', icon: Settings, active: s.routeState.panelKind === 'settings', href: settingsHref, onSelect: () => s.router.push(settingsHref) },
    ...s.railFooterItems,
  ]
  const mobileSidebarProps = resolveMobileSidebarProps({
    classicLayout,
    railItems: s.railItems,
    classicFooterItems: railFooterItems,
    unifiedFooterItems: s.railFooterItems,
    closeMobileDrawer: s.closeMobileDrawer,
  })
  const sidebarProps = {
    useSecondarySidebar: classicLayout,
    brand: brandLink,
    railBrand: <SidebarBrandLink href={brandHomeHref} logoSrc={s.brandConfig.logoSrc} logoAlt={s.brandConfig.logoAlt} label={brandLabel} onNavigate={s.closeMobileDrawer} className="flex size-10 items-center justify-center rounded-lg" labelClassName="sr-only" markOnly />,
    title: s.panelTitle,
    themePreset: appSettings?.settings.theme === 'dark' ? appSettings.settings.darkThemePreset : appSettings?.settings.lightThemePreset,
    items: s.railItems,
    footerItems: classicLayout ? railFooterItems : s.railFooterItems,
    panelKind: s.routeState.panelKind,
    panelNav: s.panelNav,
    panelAction: s.panelAction,
    sectionActions,
    renderSection,
    sectionRows,
    scope: s.routeState.scope,
  }

  return (
    <ShellAdapterProvider value={shellAdapter}>
    <>
      <MobileTopBar
        hidden={s.hideTemporaryChatChrome}
        brandLink={
          <SidebarBrandLink
            href={brandHomeHref}
            logoSrc={s.brandConfig.logoSrc}
            logoAlt={s.brandConfig.logoAlt}
            label={brandLabel}
            onNavigate={s.closeMobileDrawer}
            className="flex min-w-0 max-w-[calc(100vw-8rem)] items-center gap-2"
            labelClassName="truncate text-lg font-medium tracking-tight text-(--foreground)"
          />
        }
        isGuestConfirmed={s.isGuestConfirmed}
        workspace={workspace}
        displayName={s.displayName}
        mobileAccountOpen={s.mobileAccountOpen}
        onMobileAccountOpenChange={s.setMobileAccountOpen}
        accountHeader={mobileAccountHeader}
        accountMenu={mobileAccountMenu}
        userAvatar={userAvatar}
        accountRef={s.mobileAccountRef}
        onOpenMenu={() => {
          s.setMobileView('nav')
          s.setMobileMenuOpen(true)
        }}
        onCloseMenu={s.closeMobileDrawer}
        onSignIn={() => s.requireAuth('send')}
      />

      {!classicLayout || !s.hideTemporaryChatChrome ? (
        <SelectedSidebar
          {...sidebarProps}
          panelId={classicLayout ? 'app-context-sidebar' : undefined}
          keyboardShortcut
          resizable
          collapsed={s.sidebarCollapsed}
          onCollapsedChange={(collapsed) => {
            s.setAccountMenuOpen(false)
            s.setSidebarCollapsed(collapsed)
          }}
          onSearch={() => s.openGlobalSearch(null)}
          account={desktopAccountSlot}
          className={classicLayout ? 'hidden md:flex' : `hidden h-full transition-[width,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:flex ${s.hideTemporaryChatChrome ? 'w-0 opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          {panelChildren}
        </SelectedSidebar>
      ) : null}

        <MobileDrawer open={s.mobileMenuOpen} hidden={s.hideTemporaryChatChrome} onClose={s.closeMobileDrawer}
          className={mobileSidebarProps.drawerClassName}>
          <SelectedSidebar
            {...sidebarProps}
            collapsed={false}
            inlineMore
            publishSubviews={false}
            onCollapsedChange={(collapsed) => { if (collapsed) s.closeMobileDrawer() }}
            items={mobileSidebarProps.items}
            footerItems={mobileSidebarProps.footerItems}
            onSearch={() => { s.closeMobileDrawer(); s.openGlobalSearch(null) }}
            account={mobileAccountSlot}
            className="mobile-sidebar-layout h-full w-full bg-transparent"
          >
            {panelChildren}
          </SelectedSidebar>
        </MobileDrawer>

      <GlobalSearchDialog
        open={s.globalSearchOpen}
        onClose={s.closeGlobalSearch}
        initialCategory={s.globalSearchInitialCategory}
        workspaceId={s.activeWorkspaceId}
        onNewChat={() => {
          void s.createChat()
        }}
      />
    </>
    </ShellAdapterProvider>
  )
}
