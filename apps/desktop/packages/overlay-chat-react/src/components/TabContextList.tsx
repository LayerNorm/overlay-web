import type { WindowTabSnapshot } from '@overlay/chat-core'

interface TabContextListProps {
  tabs: WindowTabSnapshot[]
}

export function TabContextList({ tabs }: TabContextListProps) {
  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#aaa]">Current Window</p>
      <div className="mt-3 space-y-2">
        {tabs.length === 0 ? (
          <p className="text-sm text-[#888]">No accessible tabs were found in the current window.</p>
        ) : (
          tabs.slice(0, 8).map((tab) => (
            <div
              key={tab.tabId}
              className={`rounded-xl border px-3 py-2 ${
                tab.active ? 'border-[#0a0a0a] bg-[#fafafa]' : 'border-[#e5e5e5] bg-[#fafafa]'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium text-[#0a0a0a]">{tab.title}</p>
                <span className="shrink-0 text-[10px] text-[#aaa]">{tab.active ? 'active' : tab.status}</span>
              </div>
              <p className="mt-1 truncate text-xs text-[#888]">{tab.url || 'No URL available'}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
