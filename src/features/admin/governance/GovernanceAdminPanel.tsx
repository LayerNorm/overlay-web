'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  Download,
  FileCheck2,
  Gavel,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react'
import type {
  GovernanceAccessReview,
  GovernancePolicy,
  GovernedResourceType,
} from '@overlay/app-core'
import { Button, IconButton, SegmentedControl } from '@overlay/ui'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

type GovernanceView = 'policies' | 'reviews'

export function GovernanceAdminPanel({
  canExport,
  canManage,
}: {
  canExport: boolean
  canManage: boolean
}) {
  const [view, setView] = useState<GovernanceView>('policies')
  const [resourceType, setResourceType] = useState<GovernedResourceType>('knowledge_base')
  const [resourceId, setResourceId] = useState('')
  const [notes, setNotes] = useState('')
  const [retentionUntil, setRetentionUntil] = useState('')
  const [reviewDueAt, setReviewDueAt] = useState('')
  const [legalHold, setLegalHold] = useState(false)
  const [policies, setPolicies] = useState<GovernancePolicy[]>([])
  const [reviews, setReviews] = useState<GovernanceAccessReview[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const filters = useMemo(() => ({
    resourceType,
    ...(resourceId.trim() ? { resourceId: resourceId.trim() } : {}),
  }), [resourceId, resourceType])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextPolicies, nextReviews] = await Promise.all([
        overlayAppClient.adminGovernance.listPolicies(filters),
        overlayAppClient.adminGovernance.listAccessReviews(filters),
      ])
      setPolicies(nextPolicies)
      setReviews(nextReviews)
    } catch (loadError) {
      setError(message(loadError))
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void load()
  }, [load])

  async function createPolicy() {
    if (!resourceId.trim() || busyId) return
    setBusyId('create-policy')
    setError(null)
    try {
      await overlayAppClient.adminGovernance.createPolicy({
        resourceType,
        resourceId: resourceId.trim(),
        legalHold,
        retentionUntil: localDateMillis(retentionUntil),
        notes: notes.trim() || undefined,
      })
      setNotes('')
      setRetentionUntil('')
      setLegalHold(false)
      await load()
    } catch (createError) {
      setError(message(createError))
    } finally {
      setBusyId(null)
    }
  }

  async function decidePolicy(policyId: string, action: 'approve' | 'reject') {
    if (busyId) return
    setBusyId(policyId)
    setError(null)
    try {
      await overlayAppClient.adminGovernance.decidePolicy({ policyId, action })
      await load()
    } catch (decisionError) {
      setError(message(decisionError))
    } finally {
      setBusyId(null)
    }
  }

  async function createReview() {
    if (!resourceId.trim() || busyId) return
    setBusyId('create-review')
    setError(null)
    try {
      await overlayAppClient.adminGovernance.createAccessReview({
        resourceType,
        resourceId: resourceId.trim(),
        dueAt: localDateMillis(reviewDueAt),
        notes: notes.trim() || undefined,
      })
      setNotes('')
      setReviewDueAt('')
      await load()
    } catch (createError) {
      setError(message(createError))
    } finally {
      setBusyId(null)
    }
  }

  async function completeReview(reviewId: string) {
    if (busyId) return
    setBusyId(reviewId)
    setError(null)
    try {
      await overlayAppClient.adminGovernance.completeAccessReview({ reviewId })
      await load()
    } catch (completeError) {
      setError(message(completeError))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section data-testid="admin-governance">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Gavel size={17} />
            <h2 className="text-sm font-semibold">Governance and compliance</h2>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Version retention rules, approve legal holds, and review who can access trusted resources.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canExport ? (
            <>
              <a
                aria-label="Download JSON compliance evidence"
                className="inline-flex size-8 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                href={overlayAppClient.adminGovernance.exportUrl({ ...filters, format: 'json' })}
                download
                title="Export JSON"
              >
                <Download size={15} />
              </a>
              <a
                className="inline-flex h-8 items-center rounded-md px-2 text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                href={overlayAppClient.adminGovernance.exportUrl({ ...filters, format: 'csv' })}
                download
              >
                CSV
              </a>
            </>
          ) : null}
          <IconButton aria-label="Refresh governance" onClick={() => void load()}>
            <RefreshCw size={15} />
          </IconButton>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--border)] py-3">
        <SegmentedControl
          ariaLabel="Governance records"
          value={view}
          onChange={setView}
          options={[
            { value: 'policies', label: 'Policies' },
            { value: 'reviews', label: 'Access reviews' },
          ]}
        />
        <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">
          <select
            aria-label="Governed resource type"
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"
            value={resourceType}
            onChange={(event) => setResourceType(event.target.value as GovernedResourceType)}
          >
            <option value="knowledge_base">Knowledge base</option>
            <option value="project">Project</option>
          </select>
          <input
            aria-label="Governed resource ID"
            className="h-8 min-w-[220px] flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-xs md:max-w-sm"
            placeholder="Resource ID"
            value={resourceId}
            onChange={(event) => setResourceId(event.target.value)}
          />
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p> : null}

      {canManage ? (
        <div className="mt-5 grid gap-3 border-b border-[var(--border)] pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(200px,0.5fr)_auto]">
          <textarea
            aria-label="Governance notes"
            className="min-h-20 resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            placeholder={view === 'policies' ? 'Policy rationale' : 'Review scope and instructions'}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <div className="space-y-3">
            {view === 'policies' ? (
              <>
                <label className="block text-xs text-[var(--muted)]">
                  Retain until
                  <input
                    className="mt-1 h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--foreground)]"
                    type="datetime-local"
                    value={retentionUntil}
                    onChange={(event) => setRetentionUntil(event.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    checked={legalHold}
                    type="checkbox"
                    onChange={(event) => setLegalHold(event.target.checked)}
                  />
                  Legal hold
                </label>
              </>
            ) : (
              <label className="block text-xs text-[var(--muted)]">
                Review due
                <input
                  className="mt-1 h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--foreground)]"
                  type="datetime-local"
                  value={reviewDueAt}
                  onChange={(event) => setReviewDueAt(event.target.value)}
                />
              </label>
            )}
          </div>
          <Button
            variant="primary"
            disabled={!resourceId.trim() || Boolean(busyId)}
            onClick={() => void (view === 'policies' ? createPolicy() : createReview())}
          >
            {busyId?.startsWith('create-') ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
            {view === 'policies' ? 'Draft policy' : 'Open review'}
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-[var(--muted)]">
          <Loader2 className="animate-spin" size={15} /> Loading governance records
        </div>
      ) : view === 'policies' ? (
        <PolicyList
          canManage={canManage}
          busyId={busyId}
          policies={policies}
          onDecide={decidePolicy}
        />
      ) : (
        <ReviewList
          canManage={canManage}
          busyId={busyId}
          reviews={reviews}
          onComplete={completeReview}
        />
      )}
    </section>
  )
}

function PolicyList({
  busyId,
  canManage,
  onDecide,
  policies,
}: {
  busyId: string | null
  canManage: boolean
  onDecide(policyId: string, action: 'approve' | 'reject'): Promise<void>
  policies: GovernancePolicy[]
}) {
  if (policies.length === 0) {
    return <EmptyState icon={<ShieldAlert size={18} />} text="No policies match this resource filter." />
  }
  return (
    <div className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
      {policies.map((policy) => (
        <div className="grid gap-3 py-4 text-sm lg:grid-cols-[minmax(0,1fr)_180px_auto]" key={policy.id}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium">{policy.resourceId}</p>
              <Status value={policy.status} />
              <span className="text-xs text-[var(--muted)]">v{policy.version}</span>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {resourceLabel(policy.resourceType)} · {policy.notes || 'No policy notes'}
            </p>
          </div>
          <div className="text-xs text-[var(--muted)]">
            <p>{policy.legalHold ? 'Legal hold active' : 'No legal hold'}</p>
            <p>{policy.retentionUntil ? `Retain until ${formatDate(policy.retentionUntil)}` : 'No retention deadline'}</p>
          </div>
          {canManage && policy.status === 'draft' ? (
            <div className="flex items-center justify-end gap-1">
              <IconButton
                disabled={busyId === policy.id}
                aria-label="Approve policy"
                onClick={() => void onDecide(policy.id, 'approve')}
              >
                <Check size={15} />
              </IconButton>
              <IconButton
                disabled={busyId === policy.id}
                aria-label="Reject policy"
                onClick={() => void onDecide(policy.id, 'reject')}
              >
                <X size={15} />
              </IconButton>
            </div>
          ) : <span />}
        </div>
      ))}
    </div>
  )
}

function ReviewList({
  busyId,
  canManage,
  onComplete,
  reviews,
}: {
  busyId: string | null
  canManage: boolean
  onComplete(reviewId: string): Promise<void>
  reviews: GovernanceAccessReview[]
}) {
  if (reviews.length === 0) {
    return <EmptyState icon={<FileCheck2 size={18} />} text="No access reviews match this resource filter." />
  }
  return (
    <div className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
      {reviews.map((review) => (
        <div className="grid gap-3 py-4 text-sm lg:grid-cols-[minmax(0,1fr)_190px_auto]" key={review.id}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium">{review.resourceId}</p>
              <Status value={review.status} />
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {resourceLabel(review.resourceType)} · {review.grants.length} access {review.grants.length === 1 ? 'grant' : 'grants'} captured
            </p>
          </div>
          <div className="text-xs text-[var(--muted)]">
            <p>Owner {review.ownerUserId || 'deleted account'}</p>
            <p>{review.dueAt ? `Due ${formatDate(review.dueAt)}` : 'No due date'}</p>
          </div>
          {canManage && review.status === 'open' ? (
            <Button
              size="sm"
              disabled={busyId === review.id}
              onClick={() => void onComplete(review.id)}
            >
              {busyId === review.id ? <Loader2 className="animate-spin" size={13} /> : <Check size={13} />}
              Complete
            </Button>
          ) : <span />}
        </div>
      ))}
    </div>
  )
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center text-[var(--muted)]">
      {icon}
      <p className="mt-3 text-sm">{text}</p>
    </div>
  )
}

function Status({ value }: { value: string }) {
  return (
    <span className="rounded bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--muted)]">
      {value}
    </span>
  )
}

function localDateMillis(value: string): number | undefined {
  if (!value) return undefined
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

function resourceLabel(value: GovernedResourceType): string {
  return value === 'knowledge_base' ? 'Knowledge base' : 'Project'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Governance request failed'
}
