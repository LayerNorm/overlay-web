/**
 * Renders a single pending ApprovalRequest with three resolution paths:
 *
 *   Approve        — run this one action
 *   Allowlist      — run this action AND any future calls of the same tool in
 *                    this conversation (cleared on conversation switch in
 *                    Phase 6)
 *   Reject         — deny and let the model re-plan
 *
 * A read-only action (e.g. `page.inspect`) should generally not reach this
 * component at all — the runtime only enqueues approvals for destructive
 * tools — but we still label the action so users know what was skipped.
 */
import { useState } from 'react'
import { Check, ShieldCheck, X } from 'lucide-react'
import type { ApprovalRequest } from '@overlay/extension-contracts'

interface ApprovalCardProps {
  approval: ApprovalRequest
  onResolve: (
    approvalId: string,
    decision: 'approve' | 'reject' | 'approve-allowlist',
  ) => Promise<void> | void
}

export function ApprovalCard({ approval, onResolve }: ApprovalCardProps) {
  const [busy, setBusy] = useState<null | 'approve' | 'reject' | 'approve-allowlist'>(null)

  async function resolve(decision: 'approve' | 'reject' | 'approve-allowlist') {
    if (busy) return
    setBusy(decision)
    try {
      await onResolve(approval.id, decision)
    } finally {
      setBusy(null)
    }
  }

  const targetLabel =
    approval.target?.selector ||
    approval.target?.url ||
    approval.target?.text ||
    (typeof approval.target?.tabId === 'number' ? `tab #${approval.target.tabId}` : null)

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[var(--foreground)]">
          <ShieldCheck size={14} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-[var(--foreground)]">{approval.summary}</p>
          <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-wide text-[var(--muted)]">
            {approval.toolName}
          </p>
          {targetLabel ? (
            <p className="mt-1 truncate text-[11px] text-[var(--muted)]" title={targetLabel}>
              {targetLabel}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => resolve('approve')}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--foreground)] px-2.5 py-1 text-[11px] font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check size={12} strokeWidth={2} />
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => resolve('approve-allowlist')}
          title={`Approve and auto-run "${approval.toolName}" for the rest of this chat`}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1 text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'approve-allowlist' ? 'Allowlisting…' : 'Allow for chat'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => resolve('reject')}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1 text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X size={12} strokeWidth={2} />
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </div>
  )
}

export function ApprovalCardStack({
  approvals,
  onResolve,
}: {
  approvals: ApprovalRequest[]
  onResolve: ApprovalCardProps['onResolve']
}) {
  if (approvals.length === 0) return null
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border)] bg-[var(--surface-subtle)]/40 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
        {approvals.length === 1 ? 'Approval needed' : `${approvals.length} approvals needed`}
      </p>
      {approvals.map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} onResolve={onResolve} />
      ))}
    </div>
  )
}
