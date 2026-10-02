'use client'

// Compatibility wrapper: canonical settings registry metadata lives in @overlay/app-core,
// with reusable panel rendering primitives in @overlay/modules-react.
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { redirect, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Link2, Mail, Moon, Sun, Play, Palette, ShieldCheck } from 'lucide-react'
import { AccountPageContent } from '@/app/app/account/page'
import { DefaultChatModelSetting } from '@/features/settings/components/DefaultChatModelSetting'
import { ModelCatalogSetting } from '@/features/settings/components/ModelCatalogSetting'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { SettingsSectionSkeleton } from '@overlay/ui/feedback'
import { LIGHT_PRESETS, DARK_PRESETS } from '@/shared/app/themes'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import overlayAppConfig from '@/overlay.config'
import type { BillingSettings } from '@overlay/app-core'
import { resolveOverlayAppShellConfig } from '@overlay/app-core'
import { resolveSettingsPanel } from '@overlay/app-core/settings-account'
import { ListboxSelect } from '@overlay/ui/primitives'
import type { LinkOpenPreference } from '@overlay/app-core'
import {
  SettingRow,
  SettingsActionRow,
  SettingsCard,
  SettingsGroup,
  SettingsPageShell,
  ThemePresetRow,
} from '@overlay/modules-react/settings'
import { renderExtensionComponent } from '@/extensions/registry'
import dynamic from 'next/dynamic'
import { MemoriesLoadingState } from '@/features/knowledge/components/MemoriesLoadingState'
import { WebhookSettings } from '@/features/settings/components/WebhookSettings'
import { AgentEnvironmentSettings } from '@/features/settings/components/AgentEnvironmentSettings'
import { AgentAccountSettings } from '@/features/settings/components/AgentAccountSettings'
import { ConnectedAppsSettings } from '@/features/settings/components/ConnectedAppsSettings'
import { ComputerSettings } from '@/features/settings/components/ComputerSettings'
import { ShortcutsSettings } from '@/features/settings/components/ShortcutsSettings'
import { WorkspaceSettingsPanel } from '@/features/workspaces/components/WorkspaceSettingsPanel'
import { isWorkspaceSettingsTab } from '@/features/workspaces/lib/workspace-settings-tabs'
import { createShowcaseWorkspaceManagementClient } from '@/features/showcase/showcase-workspace-client'
import { SHOWCASE_WORKSPACES } from '@/features/showcase/showcase-data'
import { ApiKeySettings } from '@/features/settings/components/ApiKeySettings'
import { ProviderConnectionsSetting } from '@/features/settings/components/ProviderConnectionsSetting'

const MemoriesView = dynamic(
  () => import('@/features/knowledge/components/MemoriesView'),
  { loading: () => <MemoriesLoadingState /> },
)

interface MemoriesHeaderState {
  count: number
  actions: ReactNode
}

type AppSettingsApi = ReturnType<typeof useAppSettings>
type OverlayCapabilitiesApi = ReturnType<typeof useOverlayCapabilities>
type AppShellConfig = ReturnType<typeof resolveOverlayAppShellConfig>

function GeneralSettingsSection({
  settings,
  busy,
  billingSettings,
  billingEnabled,
  updateSettings,
}: {
  settings: AppSettingsApi['settings']
  busy: boolean
  billingSettings: BillingSettings | null
  billingEnabled: OverlayCapabilitiesApi['capabilities']['billing']
  updateSettings: AppSettingsApi['updateSettings']
}) {
  const router = useRouter()
  return (
    <SettingsGroup>
      <SettingRow
        icon={<Play size={18} strokeWidth={1.8} />}
        title="Auto-continue"
        description="Automatically resume chats when the assistant times out or is interrupted."
        checked={settings.autoContinue}
        disabled={busy}
        onChange={() => void updateSettings({ autoContinue: !settings.autoContinue })}
      />
      <DefaultChatModelSetting
        defaultActModelId={settings.defaultActModelId}
        defaultAskModelIds={settings.defaultAskModelIds}
        isFreeTier={billingSettings?.planKind === 'free'}
        onlyAllowZdrModels={settings.onlyAllowZdrModels}
        enabledModelIds={settings.enabledChatModelIds}
        modelOrder={settings.modelOrder}
        disabled={busy || (billingEnabled && !billingSettings)}
        onSelect={(actModelId, askModelIds) => {
          void updateSettings({
            defaultActModelId: actModelId,
            defaultAskModelIds: askModelIds,
          })
        }}
      />
      {billingEnabled ? (
        <SettingRow
          icon={<ShieldCheck size={18} strokeWidth={1.8} />}
          title="Only allow ZDR models"
          description={
            billingSettings?.planKind === 'free'
              ? 'Free models do not support zero data retention, so this is available on paid plans only.'
              : 'Hide non-ZDR text models from the chat model picker and block stale requests that use them.'
          }
          checked={billingSettings?.planKind === 'free' ? false : settings.onlyAllowZdrModels}
          disabled={busy || billingSettings?.planKind === 'free'}
          onChange={() => void updateSettings({ onlyAllowZdrModels: !settings.onlyAllowZdrModels })}
        />
      ) : null}
      <SettingsActionRow
        icon={<Link2 size={18} strokeWidth={1.8} />}
        title="Open links in"
        description="Where a link in a response opens. Overlay shows it in the right-hand panel without leaving the chat."
        action={
          <ListboxSelect<LinkOpenPreference>
            value={settings.linkOpenPreference}
            options={[
              { value: 'ask', label: 'Ask every time' },
              { value: 'overlay', label: 'Overlay' },
              { value: 'new-tab', label: 'New tab' },
            ]}
            disabled={busy}
            aria-label="Where to open links"
            className="shrink-0"
            buttonClassName="min-w-[9.5rem]"
            onChange={(linkOpenPreference) => void updateSettings({ linkOpenPreference })}
          />
        }
      />
      <SettingsActionRow
        icon={<Play size={18} strokeWidth={1.8} />}
        title="Onboarding tour"
        description="Replay the guided walkthrough that highlights the key features of the app."
        action={
          <button
            type="button"
            onClick={() => {
              void (async () => {
                await overlayAppClient.onboarding.resetResponse()
                router.push('/app/chat?tour=replay')
              })()
            }}
            className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-elevated)]"
          >
            Replay tour
          </button>
        }
      />
    </SettingsGroup>
  )
}

function AccountSettingsSection({
  supportsApiKeys,
}: {
  supportsApiKeys: OverlayCapabilitiesApi['appDataCapabilities']['supportsApiKeys']
}) {
  return (
    <Suspense fallback={null}>
      <AccountPageContent embedded />
      {supportsApiKeys ? <ApiKeySettings /> : null}
    </Suspense>
  )
}

function WorkspaceSettingsSection({
  publicShowcase,
  showcaseWorkspaceManagementClient,
  workspaceTabParam,
}: {
  publicShowcase: boolean
  showcaseWorkspaceManagementClient: ReturnType<typeof createShowcaseWorkspaceManagementClient>
  workspaceTabParam: string | null | undefined
}) {
  return (
    <WorkspaceSettingsPanel
      client={publicShowcase ? showcaseWorkspaceManagementClient : undefined}
      initialTab={isWorkspaceSettingsTab(workspaceTabParam)
        ? workspaceTabParam as Parameters<typeof WorkspaceSettingsPanel>[0]['initialTab']
        : undefined}
    />
  )
}

function CustomizationSettingsSection({
  settings,
  busy,
  updateSettings,
}: {
  settings: AppSettingsApi['settings']
  busy: boolean
  updateSettings: AppSettingsApi['updateSettings']
}) {
  return (
    <SettingsGroup>
      <SettingRow
        icon={settings.theme === 'dark' ? <Moon size={18} strokeWidth={1.8} /> : <Sun size={18} strokeWidth={1.8} />}
        title="Dark mode"
        description="Toggle the app between light and dark appearance."
        checked={settings.theme === 'dark'}
        disabled={busy}
        onChange={() => void updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
      />
      {settings.theme === 'dark' ? (
        <ThemePresetRow
          label="Dark theme"
          description="Choose the color preset used when the app is in dark mode."
          presets={DARK_PRESETS}
          value={settings.darkThemePreset}
          disabled={busy}
          icon={<Palette size={18} strokeWidth={1.8} />}
          onChange={(id) => void updateSettings({ darkThemePreset: id })}
        />
      ) : (
        <ThemePresetRow
          label="Light theme"
          description="Choose the color preset used when the app is in light mode."
          presets={LIGHT_PRESETS}
          value={settings.lightThemePreset}
          disabled={busy}
          icon={<Palette size={18} strokeWidth={1.8} />}
          onChange={(id) => void updateSettings({ lightThemePreset: id })}
        />
      )}
    </SettingsGroup>
  )
}

function MemoriesSettingsSection({
  onHeaderStateChange,
}: {
  onHeaderStateChange: (state: MemoriesHeaderState | null) => void
}) {
  return (
    <div className="h-full">
      <MemoriesView userId="" onHeaderStateChange={onHeaderStateChange} />
    </div>
  )
}

function ModelsSettingsSection({
  settings,
  busy,
  updateSettings,
}: {
  settings: AppSettingsApi['settings']
  busy: boolean
  updateSettings: AppSettingsApi['updateSettings']
}) {
  return (
    <ModelCatalogSetting
      enabledModelIds={settings.enabledChatModelIds}
      modelOrder={settings.modelOrder}
      defaultImageModelId={settings.defaultImageModelId}
      defaultVideoModelId={settings.defaultVideoModelId}
      disabled={busy}
      onChange={(patch) => void updateSettings(patch)}
    />
  )
}

function ContactSettingsSection({
  supportEmail,
}: {
  supportEmail: AppShellConfig['brand']['supportEmail']
}) {
  return (
    <SettingsCard title="Contact">
      <p className="flex items-start gap-2">
        <Mail size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" strokeWidth={1.75} />
        <span>
          Questions or feedback? Email the founder:{' '}
          <a
            href={`mailto:${supportEmail ?? 'divyansh@layernorm.co'}`}
            className="font-medium text-[var(--foreground)] underline underline-offset-4 hover:opacity-90"
          >
            {supportEmail ?? 'divyansh@layernorm.co'}
          </a>
          .
        </span>
      </p>
    </SettingsCard>
  )
}

function UnimplementedSettingsPanel({
  registeredPanel,
  sectionLabel,
  extensionSettingsPanel,
}: {
  registeredPanel: ReturnType<typeof resolveSettingsPanel>
  sectionLabel: string
  extensionSettingsPanel: ReactNode
}) {
  if (extensionSettingsPanel) return <>{extensionSettingsPanel}</>
  return (
    <SettingsCard title={registeredPanel?.label ?? sectionLabel}>
      <p>
        {registeredPanel
          ? `The settings panel ${registeredPanel.componentKey} is registered in the app shell but does not have a local web renderer yet.`
          : 'This settings section is registered in the app shell but does not have a web implementation yet.'}
      </p>
    </SettingsCard>
  )
}

function SettingsSectionContent({
  section,
  settings,
  busy,
  billingSettings,
  billingEnabled,
  supportsApiKeys,
  publicShowcase,
  showcaseWorkspaceManagementClient,
  workspaceTabParam,
  updateSettings,
  onMemoriesHeaderStateChange,
  supportEmail,
  registeredPanel,
  sectionLabel,
  extensionSettingsPanel,
}: {
  section: string
  settings: AppSettingsApi['settings']
  busy: boolean
  billingSettings: BillingSettings | null
  billingEnabled: OverlayCapabilitiesApi['capabilities']['billing']
  supportsApiKeys: OverlayCapabilitiesApi['appDataCapabilities']['supportsApiKeys']
  publicShowcase: boolean
  showcaseWorkspaceManagementClient: ReturnType<typeof createShowcaseWorkspaceManagementClient>
  workspaceTabParam: string | null | undefined
  updateSettings: AppSettingsApi['updateSettings']
  onMemoriesHeaderStateChange: (state: MemoriesHeaderState | null) => void
  supportEmail: AppShellConfig['brand']['supportEmail']
  registeredPanel: ReturnType<typeof resolveSettingsPanel>
  sectionLabel: string
  extensionSettingsPanel: ReactNode
}) {
  if (section === 'general') {
    return (
      <GeneralSettingsSection
        settings={settings}
        busy={busy}
        billingSettings={billingSettings}
        billingEnabled={billingEnabled}
        updateSettings={updateSettings}
      />
    )
  }
  if (section === 'account') return <AccountSettingsSection supportsApiKeys={supportsApiKeys} />
  if (section === 'workspace') {
    return (
      <WorkspaceSettingsSection
        publicShowcase={publicShowcase}
        showcaseWorkspaceManagementClient={showcaseWorkspaceManagementClient}
        workspaceTabParam={workspaceTabParam}
      />
    )
  }
  if (section === 'customization') {
    return <CustomizationSettingsSection settings={settings} busy={busy} updateSettings={updateSettings} />
  }
  if (section === 'shortcuts') return <ShortcutsSettings />
  if (section === 'memories') {
    return <MemoriesSettingsSection onHeaderStateChange={onMemoriesHeaderStateChange} />
  }
  if (section === 'models') {
    return <ModelsSettingsSection settings={settings} busy={busy} updateSettings={updateSettings} />
  }
  if (section === 'providers') return <ProviderConnectionsSetting />
  if (section === 'webhooks') return <WebhookSettings />
  if (section === 'agent-environments') return <AgentEnvironmentSettings />
  if (section === 'agent-accounts') return <AgentAccountSettings />
  if (section === 'connected-apps') return <ConnectedAppsSettings />
  if (section === 'computers') return <ComputerSettings />
  if (section === 'contact') return <ContactSettingsSection supportEmail={supportEmail} />
  return (
    <UnimplementedSettingsPanel
      registeredPanel={registeredPanel}
      sectionLabel={sectionLabel}
      extensionSettingsPanel={extensionSettingsPanel}
    />
  )
}

export default function Page() {
  return (
    <Suspense fallback={<SettingsSectionSkeleton />}>
      <SettingsPage />
    </Suspense>
  )
}

function SettingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { capabilities, appDataCapabilities } = useOverlayCapabilities()
  const appShell = useMemo(
    () => resolveOverlayAppShellConfig(overlayAppConfig, { capabilities }),
    [capabilities],
  )
  const sections = appShell.settingsSections
  const settingsPanels = appShell.settingsPanels
  const defaultSectionId = sections[0]?.id ?? 'general'
  const sectionIds = useMemo(() => new Set<string>(sections.map((s) => s.id)), [sections])
  const rawSection = searchParams?.get('section') ?? defaultSectionId
  const section = sectionIds.has(rawSection) ? rawSection : defaultSectionId
  const publicShowcase = searchParams?.get('showcase') === '1'
  const showcaseWorkspaceManagementClient = useMemo(
    () => createShowcaseWorkspaceManagementClient(SHOWCASE_WORKSPACES),
    [],
  )

  const { isAuthenticated, isLoading: authLoading } = useAuth()
  if (!publicShowcase && !authLoading && !isAuthenticated) {
    redirect('/app/chat?signin=nav')
  }

  const {
    settings,
    isLoading,
    isSaving,
    updateSettings,
  } = useAppSettings()
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null)
  const [memoriesHeaderState, setMemoriesHeaderState] = useState<MemoriesHeaderState | null>(null)

  const busy = isLoading || isSaving

  const sectionLabel = useMemo(
    () => sections.find((s) => s.id === section)?.label ?? 'General',
    [section, sections],
  )
  const registeredPanel = useMemo(
    () => resolveSettingsPanel(settingsPanels, section),
    [section, settingsPanels],
  )
  const extensionSettingsPanel = renderExtensionComponent(
    registeredPanel?.componentKey,
    { settingsPanel: registeredPanel ?? undefined },
  )

  useEffect(() => {
    if (!sectionIds.has(rawSection)) {
      window.history.replaceState(null, '', `/app/settings?section=${section}`)
    }
  }, [rawSection, section, router, sectionIds])

  useEffect(() => {
    if (!capabilities.billing) return
    if (section !== 'general') return
    let active = true
    void overlayAppClient.subscription.getSettingsResponse()
      .then(async (response) => {
        if (!response.ok) return null
        return await response.json()
      })
      .then((data) => {
        if (active && data) {
          setBillingSettings(data)
        }
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [capabilities.billing, section])

  return (
    <SettingsPageShell
      activeLabel={sectionLabel}
      activeDetail={
        section === 'memories' && memoriesHeaderState && memoriesHeaderState.count > 0 ? (
          <span className="text-xs text-[var(--muted-light)]">{memoriesHeaderState.count}</span>
        ) : null
      }
      actions={section === 'memories' ? memoriesHeaderState?.actions : null}
      fullBleed={section === 'memories'}
    >
      {isLoading ? (
        <SettingsSectionSkeleton rows={section === 'general' ? 3 : 1} />
      ) : (
        <SettingsSectionContent
          section={section}
          settings={settings}
          busy={busy}
          billingSettings={billingSettings}
          billingEnabled={capabilities.billing}
          supportsApiKeys={appDataCapabilities.supportsApiKeys}
          publicShowcase={publicShowcase}
          showcaseWorkspaceManagementClient={showcaseWorkspaceManagementClient}
          workspaceTabParam={searchParams?.get('workspace_tab')}
          updateSettings={updateSettings}
          onMemoriesHeaderStateChange={setMemoriesHeaderState}
          supportEmail={appShell.brand.supportEmail}
          registeredPanel={registeredPanel}
          sectionLabel={sectionLabel}
          extensionSettingsPanel={extensionSettingsPanel}
        />
      )}
    </SettingsPageShell>
  )
}
