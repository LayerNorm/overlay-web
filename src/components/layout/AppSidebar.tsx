'use client'

import NextLink from 'next/link'
import dynamic from 'next/dynamic'
import { CircleHelp, Moon, Settings, Sun } from 'lucide-react'
import { CollapsibleSection } from '@overlay/ui/primitives'
import { DoubleSidebar, ShellAdapterProvider, SidebarAccountMenu, UnifiedSidebar, type PrimaryRailItem, type ShellAdapter } from '@overlay/shell-react'
import { StorageBar, UsageBar } from './sidebar/SidebarUsageMeters'
import {
  DesktopAccountSlot,
  MobileDrawer,
  MobileSidebar,
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
  const accountMenuContent = (
    <SidebarAccountMenu
      {...accountMenuProps}
      onAccountClick={s.closeAccountMenus}
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
      onAccountClick={() => s.setMobileAccountOpen(false)}
      onSignOut={() => {
        s.setMobileAccountOpen(false)
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
      accountMenu={accountMenuContent}
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
      chatPanelRefreshKey={s.chatPanelRefreshKey}
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
        chatPanelRefreshKey={s.chatPanelRefreshKey}
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
        accountMenu={mobileAccountMenu}
        accountRef={s.mobileAccountRef}
        onOpenMenu={() => {
          s.setMobileView('nav')
          s.setMobileMenuOpen(true)
        }}
        onCloseMenu={s.closeMobileDrawer}
      />

      {classicLayout ? null : (
        <UnifiedSidebar
          brand={brandLink}
          keyboardShortcut
          resizable
          collapsed={s.sidebarCollapsed}
          onCollapsedChange={(collapsed) => {
            s.setAccountMenuOpen(false)
            s.setSidebarCollapsed(collapsed)
          }}
          items={s.railItems}
          footerItems={s.railFooterItems}
          panelKind={s.routeState.panelKind}
          panelNav={s.panelNav}
          panelAction={s.panelAction}
          sectionActions={sectionActions}
          renderSection={renderSection}
          sectionRows={sectionRows}
          onSearch={() => s.openGlobalSearch(null)}
          scope={s.routeState.scope}
          account={desktopAccountSlot}
          className={`hidden h-full transition-[width,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:flex ${
            s.hideTemporaryChatChrome ? 'w-0 opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          {panelChildren}
        </UnifiedSidebar>
      )}

      {classicLayout && !s.hideTemporaryChatChrome ? (
      <DoubleSidebar
        brand={brandLink}
        railBrand={<SidebarBrandLink href={brandHomeHref} logoSrc={s.brandConfig.logoSrc} logoAlt={s.brandConfig.logoAlt} label={brandLabel} onNavigate={s.closeMobileDrawer} className="flex size-10 items-center justify-center rounded-lg" labelClassName="sr-only" markOnly />}
        title={s.panelTitle}
        panelId="app-context-sidebar"
        themePreset={appSettings?.settings.theme === 'dark' ? appSettings.settings.darkThemePreset : appSettings?.settings.lightThemePreset}
        keyboardShortcut
        resizable
        collapsed={s.sidebarCollapsed}
        onCollapsedChange={(collapsed) => {
          s.setAccountMenuOpen(false)
          s.setSidebarCollapsed(collapsed)
        }}
        items={s.railItems}
        footerItems={railFooterItems}
        panelKind={s.routeState.panelKind}
        panelNav={s.panelNav}
        panelAction={s.panelAction}
        sectionActions={sectionActions}
        renderSection={renderSection}
        sectionRows={sectionRows}
        onSearch={() => s.openGlobalSearch(null)}
        scope={s.routeState.scope}
        account={desktopAccountSlot}
        className={s.hideTemporaryChatChrome ? 'hidden' : 'hidden md:flex'}
      >
        {panelChildren}
      </DoubleSidebar>
      ) : null}

      {classicLayout ? (
        <MobileSidebar
          open={s.mobileMenuOpen}
          hidden={s.hideTemporaryChatChrome}
          onClose={s.closeMobileDrawer}
          view={s.mobileView}
          showPanel={s.routeState.showSecondaryPanel}
          onBack={() => s.setMobileView('nav')}
          panelTitle={s.panelTitle}
          panelNav={s.panelNav}
          panelAction={s.panelAction}
          panelSearch={s.panelSearch}
          panelChildren={panelChildren}
          brandLink={brandLink}
          navItems={s.mobileNavItems}
          onSelectItem={s.onSelectMobileNavItem}

          menuRef={s.mobileMenuRef}
          isGuestConfirmed={s.isGuestConfirmed}
          workspace={workspace}
          displayName={s.displayName}
          accountMenuOpen={s.accountMenuOpen}
          onAccountMenuOpenChange={s.setAccountMenuOpen}
          accountMenu={accountMenuContent}
          onSignIn={() => s.requireAuth('send')}
        />
      ) : (
        <MobileDrawer open={s.mobileMenuOpen} hidden={s.hideTemporaryChatChrome} onClose={s.closeMobileDrawer}>
          <UnifiedSidebar
            brand={brandLink}
            collapsed={false}
            inlineMore
            publishSubviews={false}
            onCollapsedChange={s.closeMobileDrawer}
            items={s.railItems.map((item) => ({ ...item, onSelect: () => { s.closeMobileDrawer(); item.onSelect() } }))}
            footerItems={s.railFooterItems?.map((item) => ({ ...item, onSelect: () => { s.closeMobileDrawer(); item.onSelect() } }))}
            panelKind={s.routeState.panelKind}
            panelNav={s.panelNav}
            panelAction={s.panelAction}
            sectionActions={sectionActions}
            renderSection={renderSection}
            sectionRows={sectionRows}
            onSearch={() => { s.closeMobileDrawer(); s.openGlobalSearch(null) }}
            scope={s.routeState.scope}
            account={desktopAccountSlot}
            className="h-full w-full bg-transparent"
          >
            {panelChildren}
          </UnifiedSidebar>
        </MobileDrawer>
      )}

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
