import type { ReactNode } from 'react'
import { CSSProperties, ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import { MessageSquare, Plus } from 'lucide-react'
import type { Theme } from '../utils/theme'
import { desktopAppJson, unwrapPaginatedData } from '../services/app-api-client'
import { createNewChat, setLastOpenedChatId } from '../utils/chatStorage'

interface ProjectDetailPageProps {
  projectId: string
  theme: Theme
  onOpenChat: (chatId: string) => void
  headerLeftSlot?: ReactNode
}

interface ProjectDoc {
  _id: string
  name: string
  instructions?: string
  createdAt: number
  updatedAt: number
}

interface ConversationDoc {
  _id: string
  title: string
  projectId?: string
  createdAt: number
  updatedAt?: number
  lastModified?: number
  lastMode?: 'ask' | 'act'
  deletedAt?: number
}

export function ProjectDetailPage({
  projectId,
  theme,
  onOpenChat,
  headerLeftSlot
}: ProjectDetailPageProps): ReactElement<any> {
  const [project, setProject] = useState<ProjectDoc | null>(null)
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [conversations, setConversations] = useState<ConversationDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDark = theme.isDark

  const loadProject = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [projectDoc, allConversations] = await Promise.all([
        desktopAppJson<ProjectDoc>(
          `/api/v1/projects?projectId=${encodeURIComponent(projectId)}`
        ),
        desktopAppJson<ConversationDoc[] | { data: ConversationDoc[] }>('/api/v1/conversations')
          .then(unwrapPaginatedData<ConversationDoc>)
          .catch(() => [])
      ])
      setProject(projectDoc)
      setName(projectDoc.name || '')
      setInstructions(projectDoc.instructions || '')
      setConversations(
        allConversations
          .filter((conversation) => !conversation.deletedAt && conversation.projectId === projectId)
          .sort(
            (a, b) =>
              (b.updatedAt ?? b.lastModified ?? b.createdAt) -
              (a.updatedAt ?? a.lastModified ?? a.createdAt)
          )
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadProject()
  }, [loadProject])

  const dirty = useMemo(
    () => Boolean(project && (name !== project.name || instructions !== (project.instructions || ''))),
    [instructions, name, project]
  )

  const saveProject = useCallback(async (): Promise<void> => {
    if (!dirty) return
    setSaving(true)
    setError(null)
    try {
      const result = await desktopAppJson<{ project?: ProjectDoc }>('/api/v1/projects', {
        method: 'PATCH',
        body: JSON.stringify({
          projectId,
          name: name.trim() || 'Untitled Project',
          instructions
        })
      })
      const nextProject = result.project
      if (nextProject) {
        setProject(nextProject)
        setName(nextProject.name || '')
        setInstructions(nextProject.instructions || '')
      }
      window.dispatchEvent(new Event('overlay:projects-changed'))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save project')
    } finally {
      setSaving(false)
    }
  }, [dirty, instructions, name, projectId])

  const startProjectChat = useCallback(async (): Promise<void> => {
    const chat = await createNewChat(undefined, projectId, false, name.trim() || 'New Chat')
    setLastOpenedChatId(chat.id)
    onOpenChat(chat.id)
  }, [name, onOpenChat, projectId])

  const fieldStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${theme.border}`,
    background: isDark ? '#111113' : '#fafafa',
    color: theme.text,
    borderRadius: 8,
    outline: 'none',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  }

  if (loading) {
    return (
      <div style={{ padding: 24, color: theme.textSecondary, fontSize: 13 }}>Loading project...</div>
    )
  }

  if (error && !project) {
    return <div style={{ padding: 24, color: '#ef4444', fontSize: 13 }}>{error}</div>
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: theme.text,
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 44,
          borderBottom: `1px solid ${theme.border}`,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0
        }}
      >
        {headerLeftSlot}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void saveProject()}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            background: 'transparent',
            padding: 0,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 13,
            fontWeight: 600,
            color: theme.text,
            outline: 'none',
            lineHeight: 1.2
          }}
        />
        <button
          type="button"
          onClick={() => void startProjectChat()}
          title="New chat in project"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            color: theme.text,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <Plus size={15} />
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 24,
          boxSizing: 'border-box'
        }}
      >
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <label style={{ display: 'block', fontSize: 11, color: theme.textSecondary, marginBottom: 8 }}>
            Instructions
          </label>
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            onBlur={() => void saveProject()}
            placeholder="Project-specific context and preferences..."
            rows={7}
            style={{ ...fieldStyle, padding: 12, resize: 'vertical', lineHeight: 1.5, fontSize: 13 }}
          />
          {error && <div style={{ marginTop: 10, color: '#ef4444', fontSize: 12 }}>{error}</div>}
          {saving && <div style={{ marginTop: 10, color: theme.textSecondary, fontSize: 12 }}>Saving...</div>}

          <div
            style={{
              marginTop: 28,
              borderTop: `1px solid ${theme.border}`,
              paddingTop: 18
            }}
          >
            <div style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 10 }}>Chats</div>
            {conversations.length === 0 ? (
              <div style={{ color: theme.textSecondary, fontSize: 12 }}>No chats in this project yet.</div>
            ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {conversations.map((conversation) => (
                <button
                  key={conversation._id}
                  type="button"
                  onClick={() => onOpenChat(conversation._id)}
                  style={{
                    height: 38,
                    border: 'none',
                    borderRadius: 8,
                    background: 'transparent',
                    color: theme.text,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '0 10px',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = theme.surface
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'transparent'
                  }}
                >
                  <MessageSquare size={14} color={theme.textSecondary} />
                  <span
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 13
                    }}
                  >
                    {conversation.title || 'New Chat'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
  )
}
