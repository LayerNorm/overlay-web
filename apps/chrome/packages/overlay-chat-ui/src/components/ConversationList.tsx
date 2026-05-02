import { MessageSquare } from 'lucide-react'

export interface ConversationItem {
  id: string
  title: string
  preview: string
  modifiedLabel: string
}

/** Matches app ChatInlinePanel row styling (AppSidebarInlinePanels). */
const panelItemClass =
  'group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'

interface ConversationListProps {
  conversations: ConversationItem[]
  activeId: string
  onSelect: (id: string) => void
}

export function ConversationList({ conversations, activeId, onSelect }: ConversationListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3">
      {conversations.length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">No chats yet</p>
      ) : (
        conversations.map((conversation) => {
          const active = conversation.id === activeId
          return (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onSelect(conversation.id)}
              className={`${panelItemClass} text-left ${active ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
            >
              <MessageSquare size={12} className="mt-0.5 shrink-0 self-start" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={`truncate font-medium ${active ? 'text-[var(--foreground)]' : 'text-[var(--muted)] group-hover:text-[var(--foreground)]'}`}
                  >
                    {conversation.title}
                  </p>
                  <span
                    className={`shrink-0 tabular-nums text-[10px] ${active ? 'text-[var(--muted)]' : 'text-[var(--muted-light)]'}`}
                  >
                    {conversation.modifiedLabel}
                  </span>
                </div>
                {conversation.preview ? (
                  <p
                    className={`mt-0.5 line-clamp-2 text-[11px] leading-relaxed ${active ? 'text-[var(--muted)]' : 'text-[var(--muted)]'}`}
                  >
                    {conversation.preview}
                  </p>
                ) : null}
              </div>
            </button>
          )
        })
      )}
    </div>
  )
}
