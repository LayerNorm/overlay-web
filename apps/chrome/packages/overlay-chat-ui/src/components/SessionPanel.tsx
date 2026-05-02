import { RefreshCw, LogOut } from 'lucide-react'

interface SessionPanelProps {
  connected: boolean
  userLabel: string
  detail: string
  loading?: boolean
  onRefresh?: () => void
  onSignOut?: () => void
}

export function SessionPanel({
  connected,
  userLabel,
  detail,
  loading,
  onRefresh,
  onSignOut,
}: SessionPanelProps) {
  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#0a0a0a]">{userLabel}</p>
          <p className="mt-1 text-xs text-[#888]">{detail}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${
          connected ? 'bg-[#ecfdf5] text-[#065f46]' : 'bg-[#f5f5f5] text-[#71717a]'
        }`}>
          {connected ? 'Connected' : 'Local only'}
        </span>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={!connected || loading}
          className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] px-2.5 py-1.5 text-xs text-[#525252] transition-colors hover:bg-[#f5f5f5] hover:text-[#0a0a0a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
        <button
          type="button"
          onClick={onSignOut}
          disabled={!connected}
          className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] px-2.5 py-1.5 text-xs text-[#525252] transition-colors hover:bg-[#f5f5f5] hover:text-[#0a0a0a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogOut size={12} />
          Sign out
        </button>
      </div>
    </div>
  )
}
