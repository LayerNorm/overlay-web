import { useEffect, useMemo } from 'react'
import { Bot, MessageSquare, Mic, Plus } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import type { Transcription } from '../../../types/transcription'
import { SidebarItemAction, SidebarListItem } from '../components/ui/SidebarListItem'
import { useChatContext } from '../contexts/ChatContext'
import { useEnvironments } from '../contexts/EnvironmentContext'
import { useTranscriptions } from '../hooks/useTranscriptions'
import type { Theme } from '../utils/theme'

export function ChatSidebarSection({
  theme,
  scope,
  selectedChatId,
  onSelectChat,
  includeAgentChats = false,
  searchOpen = false,
  searchQuery = '',
  onSearchQueryChange,
}: {
  theme: Theme
  scope: 'personal' | 'workspace'
  selectedChatId: string | null
  onSelectChat: (chatId: string) => void
  includeAgentChats?: boolean
  searchOpen?: boolean
  searchQuery?: string
  onSearchQueryChange?: (value: string) => void
}): React.ReactElement<any> {
  const { conversations, isLoading, setChatView } = useChatContext()
  useEffect(() => {
    setChatView(scope === 'personal' ? 'personal' : 'workspace')
  }, [scope, setChatView])
  const chats = useMemo(
    () =>
      (conversations ?? []).filter(
        (chat) =>
          Boolean(chat.isAgent) === includeAgentChats &&
          chat.title.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [conversations, includeAgentChats, searchQuery],
  )
  if (isLoading && chats.length === 0) {
    return <p className="px-3 py-2 text-xs text-(--muted)">Loading chats</p>
  }
  return (
    <div className="min-w-0">
      {searchOpen ? (
        <input
          type="search"
          aria-label="Search chats"
          placeholder="Search chats"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange?.(event.target.value)}
          className="mx-2 mb-2 h-8 w-[calc(100%-1rem)] rounded-md border border-(--border) bg-(--background) px-2 text-xs text-(--foreground) outline-none placeholder:text-(--muted)"
        />
      ) : null}
      {chats.map((chat) => (
        <SidebarListItem
          key={chat.id}
          icon={MessageSquare}
          label={chat.title || 'Untitled chat'}
          isActive={selectedChatId === chat.id}
          isSelectMode={false}
          isBatchSelected={false}
          onBatchToggle={() => undefined}
          onClick={() => onSelectChat(chat.id)}
          theme={theme}
        />
      ))}
      {chats.length === 0 ? (
        <p className="px-3 py-2 text-xs text-(--muted)">No chats yet</p>
      ) : null}
    </div>
  )
}

export function AgentSidebarSection({
  theme,
  selectedAgentId,
  onSelectAgent,
  onNewAgent,
  onNewThread,
}: {
  theme: Theme
  selectedAgentId: string | null
  onSelectAgent: (agentId: string) => void
  onNewAgent: () => void
  onNewThread?: (agentId: string) => void
}): React.ReactElement<any> {
  const { status, agents } = useEnvironments()
  const sorted = useMemo(
    () => [...agents].sort((left, right) => left.name.localeCompare(right.name)),
    [agents],
  )
  return (
    <div className="min-w-0">
      <Button
        variant="ghost"
        type="button"
        onClick={onNewAgent}
        className="mx-2 mb-2 flex h-8 w-[calc(100%-1rem)] justify-start gap-2 rounded-md bg-(--surface-subtle) px-2 text-left text-xs font-medium text-(--foreground) hover:bg-(--border)"
      >
        <Bot size={14} aria-hidden />
        New agent
      </Button>
      {status === 'loading' && sorted.length === 0 ? (
        <p className="px-3 py-2 text-xs text-(--muted)">Loading agents</p>
      ) : null}
      {sorted.map((agent) => (
        <SidebarListItem
          key={agent.id}
          icon={Bot}
          label={agent.name}
          sublabel={agent.modelId || 'Overlay agent'}
          isActive={selectedAgentId === agent.id}
          isSelectMode={false}
          isBatchSelected={false}
          onBatchToggle={() => undefined}
          onClick={() => onSelectAgent(agent.id)}
          actions={
            onNewThread ? (
              <SidebarItemAction
                title="New thread"
                icon={Plus}
                onClick={(event) => {
                  event.stopPropagation()
                  onNewThread(agent.id)
                }}
              />
            ) : undefined
          }
          theme={theme}
        />
      ))}
      {sorted.length === 0 && status !== 'loading' ? (
        <p className="px-3 py-2 text-xs text-(--muted)">No agents yet</p>
      ) : null}
    </div>
  )
}

export function VoiceSidebarSection({
  theme,
  selectedId,
  onSelect,
}: {
  theme: Theme
  selectedId: string | null
  onSelect: (transcription: Transcription) => void
}): React.ReactElement<any> {
  const { transcriptions } = useTranscriptions()
  return (
    <div className="min-w-0">
      {transcriptions.map((transcription) => (
        <SidebarListItem
          key={transcription.id}
          icon={Mic}
          label={transcription.text.trim().split(/\s+/).slice(0, 7).join(' ') || 'Voice session'}
          sublabel={new Date(transcription.timestamp).toLocaleDateString()}
          isActive={selectedId === transcription.id}
          isSelectMode={false}
          isBatchSelected={false}
          onBatchToggle={() => undefined}
          onClick={() => onSelect(transcription)}
          theme={theme}
        />
      ))}
      {transcriptions.length === 0 ? (
        <p className="px-3 py-2 text-xs text-(--muted)">No voice sessions yet</p>
      ) : null}
    </div>
  )
}
