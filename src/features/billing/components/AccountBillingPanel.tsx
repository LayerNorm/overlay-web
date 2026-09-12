'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import {
  AccountFreeUsageCard,
  AccountPaidUsageCard,
  AccountSubscriptionCard,
  BillingControlsPanel,
  EntitlementsErrorPanel,
  TopUpHistoryList,
} from '@overlay/modules-react/settings'
import type {
  AccountEntitlements,
  BillingSettings,
  TopUpHistoryItem,
} from '@overlay/app-core'
import { TopUpPreferenceControl } from '@/features/billing/components/TopUpPreferenceControl'
import { formatBytes } from '@/shared/storage/storage-limits'

export function AccountBillingPanel({
  actionLoading,
  autoTopUpEnabledDraft,
  billingEnabled,
  billingSettings,
  dark,
  entitlements,
  entitlementsError,
  headingClass,
  mutedClass,
  onManageBilling,
  onRetryEntitlements,
  onSaveTopUpPreference,
  onStartTopUp,
  panelClass,
  setAutoTopUpEnabledDraft,
  setTopUpAmountDraftCents,
  topUpAmountDraftCents,
  topUpHistory,
}: {
  actionLoading: string | null
  autoTopUpEnabledDraft: boolean
  billingEnabled: boolean
  billingSettings: BillingSettings | null
  dark: boolean
  entitlements: AccountEntitlements | null
  entitlementsError: string | null
  headingClass: string
  mutedClass: string
  onManageBilling: () => void | Promise<void>
  onRetryEntitlements: () => void
  onSaveTopUpPreference: () => void | Promise<void>
  onStartTopUp: (amountCents: number, autoTopUpEnabled: boolean) => void | Promise<void>
  panelClass: string
  setAutoTopUpEnabledDraft: (value: boolean) => void
  setTopUpAmountDraftCents: (value: number) => void
  topUpAmountDraftCents: number
  topUpHistory: TopUpHistoryItem[]
}) {
  return (
    <>
      {entitlementsError ? (
        <EntitlementsErrorPanel message={entitlementsError} onRetry={onRetryEntitlements} />
      ) : null}

      {!billingEnabled ? (
        <section className={panelClass}>
          <h2 className={`text-xl font-serif ${headingClass}`}>Billing unavailable</h2>
          <p className={`mt-2 text-sm ${mutedClass}`}>
            This deployment does not use Overlay-managed billing. Your workspace access is controlled by the deployment administrator.
          </p>
        </section>
      ) : null}

      {billingEnabled && entitlements ? (
        <>
          <AccountSubscriptionCard
            panelClass={panelClass}
            headingClass={headingClass}
            mutedClass={mutedClass}
            dark={dark}
            entitlements={entitlements}
            actions={
              <>
                {entitlements.planKind === 'free' ? (
                  <Link
                    href="/pricing"
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 ${
                      dark ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-white'
                    }`}
                  >
                    Upgrade to paid
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                ) : null}
                {entitlements.planKind === 'paid' ? (
                  <>
                    <Link
                      href="/pricing?intent=change-plan"
                      className={`rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
                        dark
                          ? 'border-zinc-600 bg-zinc-900 text-zinc-100 hover:bg-zinc-800'
                          : 'border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50'
                      }`}
                    >
                      Change plan
                    </Link>
                    <button
                      type="button"
                      onClick={() => void onManageBilling()}
                      disabled={actionLoading === 'billing'}
                      className={`rounded-lg border px-4 py-2 text-sm font-medium transition-all disabled:opacity-50 ${
                        dark
                          ? 'border-zinc-600 bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
                          : 'border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50'
                      }`}
                    >
                      {actionLoading === 'billing' ? 'Opening...' : 'Manage billing'}
                    </button>
                  </>
                ) : null}
              </>
            }
          />

          {entitlements.planKind === 'paid' ? (
            <>
              <AccountPaidUsageCard
                panelClass={panelClass}
                headingClass={headingClass}
                mutedClass={mutedClass}
                dark={dark}
                entitlements={entitlements}
                storageUsageLabel={`${formatBytes(entitlements.overlayStorageBytesUsed)} / ${formatBytes(entitlements.overlayStorageBytesLimit)}`}
              />

              <BillingControlsPanel panelClass={panelClass} headingClass={headingClass} mutedClass={mutedClass}>
                <div className="mt-5">
                  <TopUpPreferenceControl
                    variant="marketing"
                    isDark={dark}
                    title="Top-up amount"
                    description="The same amount is used for manual top-ups and, if enabled, future automatic recharges."
                    amountCents={topUpAmountDraftCents}
                    minAmountCents={billingSettings?.topUpMinAmountCents ?? 800}
                    maxAmountCents={billingSettings?.topUpMaxAmountCents ?? 20_000}
                    stepAmountCents={billingSettings?.topUpStepAmountCents ?? 100}
                    onAmountChange={setTopUpAmountDraftCents}
                    autoTopUpEnabled={autoTopUpEnabledDraft}
                    onAutoTopUpEnabledChange={setAutoTopUpEnabledDraft}
                    checkboxDescription="If enabled, this same amount will recharge automatically whenever your cumulative budget reaches zero."
                    note="Saving or checking the box authorizes off-session recharges for the selected amount."
                    footer={
                      <>
                        <button
                          type="button"
                          onClick={() => void onStartTopUp(topUpAmountDraftCents, autoTopUpEnabledDraft)}
                          disabled={actionLoading === `topup-${topUpAmountDraftCents}`}
                          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-all disabled:opacity-50 ${
                            dark
                              ? 'border-zinc-600 bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
                              : 'border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50'
                          }`}
                        >
                          {actionLoading === `topup-${topUpAmountDraftCents}` ? 'Opening…' : `Add $${(topUpAmountDraftCents / 100).toFixed(0)} top-up`}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onSaveTopUpPreference()}
                          disabled={actionLoading === 'topup-settings'}
                          className={`rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:opacity-50 ${
                            dark
                              ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
                              : 'bg-zinc-900 text-white hover:bg-zinc-800'
                          }`}
                        >
                          {actionLoading === 'topup-settings' ? 'Saving...' : 'Save top-up preference'}
                        </button>
                      </>
                    }
                  />
                </div>
                <TopUpHistoryList
                  items={topUpHistory}
                  headingClass={headingClass}
                  mutedClass={mutedClass}
                  dark={dark}
                />
              </BillingControlsPanel>
            </>
          ) : (
            <AccountFreeUsageCard
              panelClass={panelClass}
              headingClass={headingClass}
              mutedClass={mutedClass}
              dark={dark}
              entitlements={entitlements}
            />
          )}
        </>
      ) : null}
    </>
  )
}
