import { ArrowUp, Globe, Paperclip } from 'lucide-react'

interface ComposerCardProps {
  scopeLabel: string
}

export function ComposerCard({ scopeLabel }: ComposerCardProps) {
  return (
    <div className="border-t border-[#e5e5e5] bg-white p-4">
      <div className="rounded-2xl border border-[#e5e5e5] bg-[#fafafa] p-3 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
        <div className="mb-3 flex items-center gap-2 text-[11px] text-[#71717a]">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#f0f0f0] px-2 py-1">
            <Globe size={11} />
            {scopeLabel}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#f0f0f0] px-2 py-1">
            Phase 0-1 shell
          </span>
        </div>
        <div className="min-h-24 rounded-xl bg-white px-3 py-3 text-sm text-[#888]">
          Ask about this page, the current window, or your chat context…
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#71717a] transition-colors hover:bg-[#f0f0f0] hover:text-[#0a0a0a]"
          >
            <Paperclip size={12} />
            Attach
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#0a0a0a] text-[#fafafa] transition-colors hover:bg-[#222]"
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
