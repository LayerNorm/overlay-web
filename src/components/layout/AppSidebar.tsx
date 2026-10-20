'use client'

import dynamic from 'next/dynamic'
const GlobalSearchDialog = dynamic(() => import('./GlobalSearchDialog').then((mod) => ({ default: mod.GlobalSearchDialog })))
import { SidebarAccountMenu } from './sidebar/SidebarAccountMenu'
import { AppSidebarPrimaryRail } from './sidebar/AppSidebarPrimaryRail'
import { AppSidebarSecondaryPanel } from './sidebar/AppSidebarSecondaryPanel'
import {
  DesktopAccountSlot,
  MobileDrawer,
  MobileSidebar,
  MobileTopBar,
  SecondaryPanelResourceList,
  SidebarBrandLink,
  SidebarRailBrand,
} from './sidebar/AppSidebarChrome'
import { UnifiedSidebar } from './sidebar/UnifiedSidebar'
import { signOutToLanding } from './sidebar/appSidebarNav'
import { useOptionalAppSettings } from '@/components/providers/AppSettingsProvider'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import { useAppSidebarState } from './sidebar/useAppSidebarState'
import { EMPTY_COLLABORATION_NOTIFICATIONS, type AppSidebarProps } from './appSidebarTypes'
import { ROOT_SHOWCASE_DESTINATION } from '@/shared/auth/root-entry'
import { WORK_FILTER_LABELS, type WorkFilter } from '@/shared/work/query'
import type { InlineNavItem } from './AppSidebarInlinePanels'

const WORK_SECTION_ORDER: readonly WorkFilter[] = ['needs-you', 'mine', 'all']
const WORK_SECTION_ROWS: ReadonlyArray<InlineNavItem> = WORK_SECTION_ORDER.map((id) => ({ id, label: WORK_FILTER_LABELS[id] }))

export type {
  AppSidebarChatPanelContext,
  AppSidebarNavigateContext,
  AppSidebarProps,
  AppSidebarWorkspaceAdapter,
} from './appSidebarTypes'

export default function AppSidebar({
  collaborationNotifications = EMPTY_COLLABORATION_NOTIFICATIONS,
  publicShowcase = false,
  renderChatPanel,
  renderAutomationsPanel,
  renderFilesPanel,
  renderAgentsPanel,
  renderWorkSection,
  workspace,
}: AppSidebarProps) {
  const s = useAppSidebarState({
    collaborationNotifications,
    publicShowcase,
    workspace,
  })
  const classicLayout = useOptionalAppSettings()?.settings.useSecondarySidebar === true
  const solo = useIsSoloWorkspace()
  const railExpanded = !s.sidebarCollapsed
  const brandHomeHref = publicShowcase ? ROOT_SHOWCASE_DESTINATION : s.brandConfig.homeHref
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

  const accountMenuProps = {
    billingEnabled: s.billingEnabled,
    entitlements: s.entitlements,
    demoHref: !publicShowcase && s.user ? ROOT_SHOWCASE_DESTINATION : undefined,
  }
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

  return (
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
          onSearch={publicShowcase ? () => s.requireAuth('history') : () => s.openGlobalSearch(null)}
          scope={s.routeState.scope}
          solo={solo}
          account={desktopAccountSlot}
          className={`hidden h-full transition-[width,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:flex ${
            s.hideTemporaryChatChrome ? 'w-0 opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          {panelChildren}
        </UnifiedSidebar>
      )}

      {classicLayout ? (
      <>
      <AppSidebarPrimaryRail
        brand={
          <SidebarRailBrand
            collapsed={s.sidebarCollapsed}
            homeHref={brandHomeHref}
            logoSrc={s.brandConfig.logoSrc}
            logoAlt={s.brandConfig.logoAlt}
            label={brandLabel}
            onExpand={() => s.setSidebarCollapsed(false)}
            onCollapse={() => {
              s.setAccountMenuOpen(false)
              s.setSidebarCollapsed(true)
            }}
          />
        }
        items={s.railItems}
        footerItems={s.railFooterItems}
        sectionNav={s.sidebarCollapsed ? s.panelNav : undefined}
        account={desktopAccountSlot}
        expanded={railExpanded}
        className={`hidden h-full transition-[width,opacity,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:flex ${
          s.hideTemporaryChatChrome
            ? 'w-0 border-transparent opacity-0 pointer-events-none'
            : `${railExpanded ? 'w-(--primary-sidebar-width)' : 'w-[72px]'} opacity-100`
        }`}
      />

      {s.routeState.showSecondaryPanel ? (
        <AppSidebarSecondaryPanel
          title={s.panelTitle}
          nav={s.panelNav}
          action={s.panelAction}
          search={s.panelSearch}
          open={!s.sidebarCollapsed}
          onOpenChange={(open) => {
            s.setAccountMenuOpen(false)
            s.setSidebarCollapsed(!open)
          }}
          className={`hidden h-full transition-[width,opacity,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:flex ${
            s.sidebarCollapsed || s.hideTemporaryChatChrome
              ? 'w-0 border-transparent opacity-0 pointer-events-none invisible'
              : 'w-(--secondary-sidebar-width) opacity-100'
          }`}
        >
          {panelChildren}
        </AppSidebarSecondaryPanel>
      ) : null}
      </>
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
          showcaseLinks={s.showcasePrimaryLinks}
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
            onSearch={publicShowcase ? () => s.requireAuth('history') : () => { s.closeMobileDrawer(); s.openGlobalSearch(null) }}
            scope={s.routeState.scope}
            solo={solo}
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
  )
}
