import type {
  OverlayAppShellRegistry,
  OverlayFeatureModule,
  OverlayIntegrationRegistration,
  OverlayModelProviderRegistration,
  OverlayPolicyGate,
  OverlaySettingsPanel,
  OverlaySettingsSection,
  OverlayToolRegistration,
} from './contracts'

export type AccountPlanKind = 'free' | 'paid'
export type AccountPlanStatus = 'active' | 'canceled' | 'past_due' | 'trialing'

export interface AccountUsageLimits {
  askPerDay: number
  agentPerDay: number
  writePerDay: number
  tokenBudget: number
  transcriptionSecondsPerWeek: number
  overlayStorageBytes: number
}

export interface AccountUsageValues {
  ask: number
  agent: number
  write: number
  tokenCostAccrued: number
  transcriptionSeconds: number
  overlayStorageBytes: number
}

export interface AccountEntitlements {
  tier: 'free' | 'pro' | 'max'
  planKind: AccountPlanKind
  planAmountCents: number
  status: AccountPlanStatus
  autoTopUpEnabled: boolean
  topUpAmountCents: number
  autoTopUpAmountCents: number
  autoTopUpConsentGranted: boolean
  budgetUsedCents: number
  budgetTotalCents: number
  budgetRemainingCents: number
  creditsUsed: number
  creditsTotal: number
  overlayStorageBytesUsed: number
  overlayStorageBytesLimit: number
  limits: AccountUsageLimits
  usage: AccountUsageValues
  remaining: AccountUsageValues
  billingPeriodEnd?: number
}

export interface BillingSettings {
  planKind: AccountPlanKind
  autoTopUpEnabled: boolean
  topUpAmountCents: number
  autoTopUpAmountCents: number
  offSessionConsentAt?: number
  topUpMinAmountCents: number
  topUpMaxAmountCents: number
  topUpStepAmountCents: number
}

export interface UpdateBillingSettingsRequest {
  autoTopUpEnabled: boolean
  confirmation: 'UPDATE_BILLING_SETTINGS'
  topUpAmountCents: number
  grantOffSessionConsent?: boolean
}

export interface TopUpHistoryItem {
  _id: string
  amountCents: number
  source: 'manual' | 'auto'
  status: 'pending' | 'succeeded' | 'failed' | 'canceled'
  createdAt: number
  updatedAt: number
  errorMessage?: string
}

export interface TopUpHistoryResponse {
  items: TopUpHistoryItem[]
}

export interface BillingPortalRequest {
  confirmation: 'OPEN_BILLING_PORTAL'
  sessionId?: string | null
}

export interface BillingPortalResponse {
  url?: string
  error?: string
}

export interface CheckoutVerifyRequest {
  sessionId: string
}

export interface CheckoutVerifyResponse {
  planAmountCents?: number
  error?: string
}

export interface TopUpCheckoutRequest {
  amountCents: number
  autoTopUpEnabled: boolean
  returnPath?: string
}

export interface TopUpCheckoutResponse {
  url?: string
  error?: string
}

export interface TopUpVerifyRequest {
  sessionId: string
}

export interface TopUpVerifyResponse {
  amountCents?: number
  error?: string
}

export interface DesktopLinkRequest {
  codeChallenge: string
  chromeExtensionId?: string
}

export interface DesktopLinkResponse {
  deepLink?: string
  error?: string
}

export interface TopUpDraftState {
  topUpAmountCents: number
  autoTopUpEnabled: boolean
}

export interface SettingsRegistrySummary {
  featureModules: readonly OverlayFeatureModule[]
  settingsPanels: readonly OverlaySettingsPanel[]
  tools: readonly OverlayToolRegistration[]
  integrations: readonly OverlayIntegrationRegistration[]
  modelProviders: readonly OverlayModelProviderRegistration[]
  policyGates: readonly OverlayPolicyGate[]
}

export function settingsPanelsForSection(
  panels: readonly OverlaySettingsPanel[],
  sectionId: OverlaySettingsSection['id'] | null | undefined,
): OverlaySettingsPanel[] {
  if (!sectionId) return []
  return panels
    .filter((panel) => panel.sectionId === sectionId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function resolveSettingsPanel(
  panels: readonly OverlaySettingsPanel[],
  sectionId: OverlaySettingsSection['id'] | null | undefined,
  panelId?: string | null,
): OverlaySettingsPanel | null {
  const sectionPanels = settingsPanelsForSection(panels, sectionId)
  return sectionPanels.find((panel) => panel.id === panelId) ?? sectionPanels[0] ?? null
}

export function buildSettingsRegistrySummary(shell: Pick<
  OverlayAppShellRegistry,
  'featureModules' | 'settingsPanels' | 'tools' | 'integrations' | 'modelProviders' | 'policyGates'
>): SettingsRegistrySummary {
  return {
    featureModules: [...shell.featureModules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    settingsPanels: [...shell.settingsPanels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    tools: [...shell.tools].sort((a, b) => a.label.localeCompare(b.label)),
    integrations: [...shell.integrations].sort((a, b) => a.label.localeCompare(b.label)),
    modelProviders: [...shell.modelProviders].sort((a, b) => a.label.localeCompare(b.label)),
    policyGates: [...shell.policyGates].sort((a, b) => a.label.localeCompare(b.label)),
  }
}

export function normalizeTopUpDraft(
  settings: Pick<BillingSettings, 'topUpAmountCents' | 'autoTopUpAmountCents' | 'topUpMinAmountCents' | 'autoTopUpEnabled'> | null | undefined,
  fallbackAmountCents = 800,
): TopUpDraftState {
  return {
    topUpAmountCents:
      settings?.topUpAmountCents ??
      settings?.autoTopUpAmountCents ??
      settings?.topUpMinAmountCents ??
      fallbackAmountCents,
    autoTopUpEnabled: Boolean(settings?.autoTopUpEnabled),
  }
}

export function formatAccountDate(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatAccountDateTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

export function formatCents(amountCents: number, fractionDigits = 2): string {
  return `$${(amountCents / 100).toFixed(fractionDigits)}`
}

export function accountPlanLabel(entitlements: Pick<AccountEntitlements, 'planKind' | 'planAmountCents'>): string {
  return entitlements.planKind === 'paid'
    ? `${(entitlements.planAmountCents / 100).toFixed(0)} dollar plan`
    : 'Free plan'
}

export function accountStatusDescription(
  entitlements: Pick<AccountEntitlements, 'status' | 'billingPeriodEnd'>,
): string {
  if (entitlements.status === 'active' && entitlements.billingPeriodEnd) {
    return `Renews ${formatAccountDate(entitlements.billingPeriodEnd)}`
  }
  if (entitlements.status === 'canceled') return 'Subscription canceled'
  if (entitlements.status === 'past_due') return 'Payment past due'
  return 'Active'
}

export function remainingUsagePercentage(used: number, total: number): number {
  return total > 0 ? Math.max(0, ((total - used) / total) * 100) : 0
}

export function usageProgressTone(remainingPercentage: number): 'empty' | 'low' | 'normal' {
  if (remainingPercentage <= 0) return 'empty'
  if (remainingPercentage <= 20) return 'low'
  return 'normal'
}
