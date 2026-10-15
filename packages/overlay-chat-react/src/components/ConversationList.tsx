import { unstyledButton } from './control-reset'
import { Button } from '@overlay/ui/primitives'
import { MessageSquare } from 'lucide-react'

export interface ConversationItem {
  id: string
  title: string
  preview: string
  modifiedLabel: string
}

/** Matches app ChatInlinePanel row styling (AppSidebarInlinePanels). */
const panelItemClass =
  'group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)'

interface ConversationListProps {
  conversations: ConversationItem[]
  activeId: string
  onSelect: (id: string) => void
}

export function ConversationList({ conversations, activeId, onSelect }: ConversationListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3">
      {conversations.length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-(--muted-light)">No chats yet</p>
      ) : (
        conversations.map((conversation) => {
          const active = conversation.id === activeId
          return (
            <Button variant="ghost"
              key={conversation.id}
              type="button"
              onClick={() => onSelect(conversation.id)}
              className={unstyledButton(`${panelItemClass} text-left ${active ? 'bg-(--surface-subtle) text-(--foreground)' : ''}`)}
            >
              <MessageSquare size={12} className="mt-0.5 shrink-0 self-start" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={`truncate font-medium ${active ? 'text-(--foreground)' : 'text-(--muted) group-hover:text-(--foreground)'}`}
                  >
                    {conversation.title}
                  </p>
                  <span
                    className={`shrink-0 tabular-nums text-[10px] ${active ? 'text-(--muted)' : 'text-(--muted-light)'}`}
                  >
                    {conversation.modifiedLabel}
                  </span>
                </div>
                {conversation.preview ? (
                  <p
                    className={`mt-0.5 line-clamp-2 text-[11px] leading-relaxed ${active ? 'text-(--muted)' : 'text-(--muted)'}`}
                  >
                    {conversation.preview}
                  </p>
                ) : null}
              </div>
            </Button>
          )
        })
      )}
    </div>
  )
}
