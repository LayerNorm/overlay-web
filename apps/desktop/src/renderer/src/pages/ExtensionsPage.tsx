import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Loader2,
  Pencil,
  Plug,
  Plus,
  Search,
  Server,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  X
} from 'lucide-react'
import type { Theme } from '../utils/theme'
import { IntegrationsSettings } from '../components/settings/IntegrationsSettings'
import { desktopAppJson, unwrapPaginatedData } from '../services/app-api-client'
import { SidebarListItem } from '../components/ui/SidebarListItem'

export type ExtensionView = 'connectors' | 'skills' | 'mcps'

type Skill = {
  _id: string
  name: string
  description: string
  instructions: string
  enabled?: boolean
  createdAt?: number
  updatedAt?: number
}

type McpServer = {
  _id: string
  name: string
  description?: string
  transport: 'sse' | 'streamable-http'
  url: string
  enabled: boolean
  authType: 'none' | 'bearer' | 'header'
  hasAuth: boolean
  timeoutMs?: number
  createdAt?: number
  updatedAt?: number
}

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

interface ExtensionsNavProps {
  theme: Theme
  activeView: ExtensionView
  onSelectView: (view: ExtensionView) => void
}

export function ExtensionsNav({
  theme,
  activeView,
  onSelectView
}: ExtensionsNavProps): React.ReactElement {
  const items = [
    { id: 'connectors' as const, label: 'Connectors', icon: Plug },
    { id: 'skills' as const, label: 'Skills', icon: Sparkles },
    { id: 'mcps' as const, label: 'MCPs', icon: Server }
  ]

  return (
    <div style={{ padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map(({ id, label, icon: Icon }) => {
        const active = activeView === id
        return (
          <SidebarListItem
            key={id}
            icon={Icon}
            iconProps={{ strokeWidth: 1.7 }}
            label={label}
            isActive={active}
            onClick={() => onSelectView(id)}
            theme={theme}
          />
        )
      })}
    </div>
  )
}

function Header({
  title,
  theme,
  search,
  onSearchChange,
  onAdd,
  addLabel,
  leftSlot
}: {
  title: string
  theme: Theme
  search?: string
  onSearchChange?: (value: string) => void
  onAdd?: () => void
  addLabel?: string
  leftSlot?: ReactNode
}): React.ReactElement {
  const showSearch = search !== undefined && onSearchChange !== undefined

  return (
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
      {leftSlot}
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: theme.text, minWidth: 96 }}>
        {title}
      </h2>
      {showSearch ? (
        <div
          style={{
            minWidth: 0,
            flex: 1,
            height: 28,
            borderRadius: 7,
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 10px'
          }}
        >
          <Search size={14} color={theme.textSecondary} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={`Search ${title.toLowerCase()}...`}
            style={{
              minWidth: 0,
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: theme.text,
              fontSize: 12,
              fontFamily: FONT
            }}
          />
        </div>
      ) : (
        <div style={{ flex: 1 }} />
      )}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          style={{
            height: 28,
            borderRadius: 7,
            border: `1px solid ${theme.border}`,
            background: theme.text,
            color: theme.background,
            padding: '0 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: FONT
          }}
        >
          <Plus size={13} />
          {addLabel}
        </button>
      )}
    </div>
  )
}

function Modal({
  theme,
  title,
  children,
  footer,
  onClose
}: {
  theme: Theme
  title: string
  children: ReactNode
  footer: ReactNode
  onClose: () => void
}): React.ReactElement {
  return (
    <div
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
    >
      <div
        style={{
          width: 'min(620px, 100%)',
          maxHeight: 'calc(100vh - 80px)',
          borderRadius: 12,
          border: `1px solid ${theme.border}`,
          background: theme.background,
          color: theme.text,
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 18px',
            borderBottom: `1px solid ${theme.border}`
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              border: 'none',
              borderRadius: 7,
              background: 'transparent',
              color: theme.textSecondary,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: 18 }}>{children}</div>
        <div
          style={{
            borderTop: `1px solid ${theme.border}`,
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  )
}

function Field({
  theme,
  label,
  children
}: {
  theme: Theme
  label: string
  children: ReactNode
}): React.ReactElement {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span
        style={{
          display: 'block',
          marginBottom: 6,
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: theme.textSecondary
        }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

function InlineError({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        borderRadius: 8,
        border: '1px solid rgba(239,68,68,0.35)',
        background: 'rgba(239,68,68,0.08)',
        color: '#ef4444',
        padding: '9px 11px',
        fontSize: 12,
        lineHeight: 1.4,
        fontFamily: FONT
      }}
    >
      {children}
    </div>
  )
}

const inputStyle = (theme: Theme): React.CSSProperties => ({
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  background: theme.surface,
  color: theme.text,
  outline: 'none',
  padding: '9px 10px',
  fontSize: 13,
  fontFamily: FONT
})

const footerButtonStyle = (theme: Theme, primary = false): React.CSSProperties => ({
  height: 34,
  borderRadius: 8,
  border: `1px solid ${primary ? theme.text : theme.border}`,
  background: primary ? theme.text : 'transparent',
  color: primary ? theme.background : theme.text,
  padding: '0 13px',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: FONT
})

function SkillDialog({
  theme,
  skill,
  onClose,
  onSaved,
  onDeleted
}: {
  theme: Theme
  skill?: Skill
  onClose: () => void
  onSaved: (skill: Skill) => void
  onDeleted: (id: string) => void
}): React.ReactElement {
  const [name, setName] = useState(skill?.name ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [instructions, setInstructions] = useState(skill?.instructions ?? '')
  const [enabled, setEnabled] = useState(skill?.enabled !== false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    if (saving) return
    const nameText = name.trim() || 'New Skill'
    const descriptionText = description.trim()
    const instructionsText = instructions.trim()
    if (!descriptionText || !instructionsText) return
    setSaving(true)
    setError(null)
    try {
      if (skill) {
        await desktopAppJson('/api/v1/skills', {
          method: 'PATCH',
          body: JSON.stringify({
            skillId: skill._id,
            name: nameText,
            description: descriptionText,
            instructions: instructionsText,
            enabled
          })
        })
        onSaved({
          ...skill,
          name: nameText,
          description: descriptionText,
          instructions: instructionsText,
          enabled
        })
      } else {
        const response = await desktopAppJson<{ id: string }>('/api/v1/skills', {
          method: 'POST',
          body: JSON.stringify({
            name: nameText,
            description: descriptionText,
            instructions: instructionsText
          })
        })
        onSaved({
          _id: response.id,
          name: nameText,
          description: descriptionText,
          instructions: instructionsText,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      }
      window.dispatchEvent(new Event('overlay:skills-changed'))
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save skill')
    } finally {
      setSaving(false)
    }
  }

  async function remove(): Promise<void> {
    if (!skill || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await desktopAppJson(`/api/v1/skills?skillId=${encodeURIComponent(skill._id)}`, {
        method: 'DELETE'
      })
      window.dispatchEvent(new Event('overlay:skills-changed'))
      onDeleted(skill._id)
      onClose()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete skill')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      theme={theme}
      title={skill ? 'Edit Skill' : 'New Skill'}
      onClose={onClose}
      footer={
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setEnabled((value) => !value)}
              style={{ ...footerButtonStyle(theme), display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
              {enabled ? 'Active' : 'Disabled'}
            </button>
            {skill && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={deleting}
                style={{ ...footerButtonStyle(theme), color: '#ef4444' }}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !description.trim() || !instructions.trim()}
            style={{ ...footerButtonStyle(theme, true), opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <Field theme={theme} label="Name">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          style={inputStyle(theme)}
        />
      </Field>
      <Field theme={theme} label="Description">
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          style={inputStyle(theme)}
        />
      </Field>
      <Field theme={theme} label="Instructions">
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          rows={12}
          style={{
            ...inputStyle(theme),
            resize: 'vertical',
            lineHeight: 1.55,
            fontFamily: 'monospace'
          }}
        />
      </Field>
      {error && <InlineError>{error}</InlineError>}
    </Modal>
  )
}

function SkillsPanel({
  theme,
  leftSlot
}: {
  theme: Theme
  leftSlot?: ReactNode
}): React.ReactElement {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dialogSkill, setDialogSkill] = useState<Skill | null | undefined>(undefined)

  const loadSkills = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSkills(
        unwrapPaginatedData<Skill>(
          await desktopAppJson<Skill[] | { data: Skill[] }>('/api/v1/skills')
        )
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load skills')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) ||
        skill.description?.toLowerCase().includes(q) ||
        skill.instructions?.toLowerCase().includes(q)
    )
  }, [skills, search])

  async function toggle(skill: Skill, event: React.MouseEvent): Promise<void> {
    event.stopPropagation()
    const enabled = skill.enabled === false
    setSkills((prev) => prev.map((item) => (item._id === skill._id ? { ...item, enabled } : item)))
    await desktopAppJson('/api/v1/skills', {
      method: 'PATCH',
      body: JSON.stringify({ skillId: skill._id, enabled })
    }).catch(() => null)
    window.dispatchEvent(new Event('overlay:skills-changed'))
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header
        title="Skills"
        theme={theme}
        search={search}
        onSearchChange={setSearch}
        onAdd={() => setDialogSkill(null)}
        addLabel="New Skill"
        leftSlot={leftSlot}
      />
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={20} className="animate-spin" color={theme.textSecondary} />
        </div>
      ) : error ? (
        <EmptyState
          theme={theme}
          icon={<Sparkles size={40} strokeWidth={1.2} />}
          title="Skills could not load"
          detail={error}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          theme={theme}
          icon={<Sparkles size={40} strokeWidth={1.2} />}
          title="No skills yet"
          detail="Create reusable instructions that the agent can follow."
        />
      ) : (
        <div style={{ overflowY: 'auto', padding: 18 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12
            }}
          >
            {filtered.map((skill) => (
              <Card key={skill._id} theme={theme} onClick={() => setDialogSkill(skill)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={iconBadgeStyle(theme)}>
                    <Sparkles size={14} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <p style={cardTitleStyle(theme)}>{skill.name || 'Untitled'}</p>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: skill.enabled === false ? theme.textSecondary : theme.text
                        }}
                      />
                    </div>
                    {skill.description && (
                      <p style={cardDescriptionStyle(theme)}>{skill.description}</p>
                    )}
                  </div>
                </div>
                {skill.instructions && (
                  <p
                    style={{
                      margin: '12px 0 0',
                      color: theme.textSecondary,
                      fontFamily: 'monospace',
                      fontSize: 10,
                      lineHeight: 1.45,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}
                  >
                    {skill.instructions}
                  </p>
                )}
                <div style={cardActionsStyle}>
                  <button
                    type="button"
                    onClick={(event) => void toggle(skill, event)}
                    style={iconButtonStyle(theme)}
                  >
                    {skill.enabled !== false ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialogSkill(skill)}
                    style={iconButtonStyle(theme)}
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
      {dialogSkill !== undefined && (
        <SkillDialog
          theme={theme}
          skill={dialogSkill ?? undefined}
          onClose={() => setDialogSkill(undefined)}
          onSaved={(skill) =>
            setSkills((prev) => {
              const idx = prev.findIndex((item) => item._id === skill._id)
              if (idx === -1) return [skill, ...prev]
              const next = [...prev]
              next[idx] = skill
              return next
            })
          }
          onDeleted={(id) => setSkills((prev) => prev.filter((skill) => skill._id !== id))}
        />
      )}
    </div>
  )
}

function McpDialog({
  theme,
  server,
  onClose,
  onSaved,
  onDeleted
}: {
  theme: Theme
  server?: McpServer
  onClose: () => void
  onSaved: (server: McpServer) => void
  onDeleted: (id: string) => void
}): React.ReactElement {
  const [name, setName] = useState(server?.name ?? '')
  const [description, setDescription] = useState(server?.description ?? '')
  const [transport, setTransport] = useState<'sse' | 'streamable-http'>(
    server?.transport ?? 'streamable-http'
  )
  const [url, setUrl] = useState(server?.url ?? '')
  const [enabled, setEnabled] = useState(server?.enabled ?? true)
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'header'>(server?.authType ?? 'none')
  const [bearerToken, setBearerToken] = useState('')
  const [headerName, setHeaderName] = useState('')
  const [headerValue, setHeaderValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const authConfig =
    authType === 'bearer' && bearerToken
      ? { bearerToken }
      : authType === 'header' && headerName && headerValue
        ? { headerName, headerValue }
        : undefined

  async function save(): Promise<void> {
    if (saving || !name.trim() || !url.trim()) return
    setSaving(true)
    setError(null)
    try {
      const body = {
        name: name.trim(),
        description: description.trim(),
        transport,
        url: url.trim(),
        enabled,
        authType,
        authConfig: authConfig ?? null
      }
      if (server) {
        await desktopAppJson('/api/v1/mcps', {
          method: 'PATCH',
          body: JSON.stringify({ mcpServerId: server._id, ...body })
        })
        onSaved({ ...server, ...body, hasAuth: Boolean(authConfig) })
      } else {
        const response = await desktopAppJson<{ id: string }>('/api/v1/mcps', {
          method: 'POST',
          body: JSON.stringify(body)
        })
        onSaved({
          _id: response.id,
          ...body,
          hasAuth: Boolean(authConfig),
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      }
      window.dispatchEvent(new Event('overlay:mcps-changed'))
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save MCP server')
    } finally {
      setSaving(false)
    }
  }

  async function remove(): Promise<void> {
    if (!server || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await desktopAppJson(`/api/v1/mcps?mcpServerId=${encodeURIComponent(server._id)}`, {
        method: 'DELETE'
      })
      window.dispatchEvent(new Event('overlay:mcps-changed'))
      onDeleted(server._id)
      onClose()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete MCP server')
    } finally {
      setDeleting(false)
    }
  }

  async function test(): Promise<void> {
    if (testing || !url.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await desktopAppJson<{
        ok?: boolean
        toolCount?: number
        error?: string
      }>('/api/v1/mcps/test', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim(), transport, authType, authConfig })
      })
      setTestResult({
        ok: Boolean(result.ok),
        message: result.ok
          ? `Connected - ${result.toolCount ?? 0} tools available`
          : result.error || 'Connection failed'
      })
    } catch (error) {
      setTestResult({
        ok: false,
        message: error instanceof Error ? error.message : 'Connection failed'
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal
      theme={theme}
      title={server ? 'Edit MCP Server' : 'Add MCP Server'}
      onClose={onClose}
      footer={
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setEnabled((value) => !value)}
              style={{ ...footerButtonStyle(theme), display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
              {enabled ? 'Active' : 'Disabled'}
            </button>
            {server && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={deleting}
                style={{ ...footerButtonStyle(theme), color: '#ef4444' }}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => void test()}
              disabled={testing || !url.trim()}
              style={footerButtonStyle(theme)}
            >
              {testing ? 'Testing...' : 'Test'}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !name.trim() || !url.trim()}
              style={{ ...footerButtonStyle(theme, true), opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </>
      }
    >
      <Field theme={theme} label="Name">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          style={inputStyle(theme)}
        />
      </Field>
      <Field theme={theme} label="Description">
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          style={inputStyle(theme)}
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field theme={theme} label="Transport">
          <select
            value={transport}
            onChange={(event) => setTransport(event.target.value as 'sse' | 'streamable-http')}
            style={inputStyle(theme)}
          >
            <option value="streamable-http">Streamable HTTP</option>
            <option value="sse">SSE</option>
          </select>
        </Field>
        <Field theme={theme} label="Auth">
          <select
            value={authType}
            onChange={(event) => setAuthType(event.target.value as 'none' | 'bearer' | 'header')}
            style={inputStyle(theme)}
          >
            <option value="none">None</option>
            <option value="bearer">Bearer token</option>
            <option value="header">Custom header</option>
          </select>
        </Field>
      </div>
      <Field theme={theme} label="URL">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          style={inputStyle(theme)}
        />
      </Field>
      {authType === 'bearer' && (
        <Field theme={theme} label="Bearer Token">
          <input
            type="password"
            value={bearerToken}
            onChange={(event) => setBearerToken(event.target.value)}
            style={inputStyle(theme)}
          />
        </Field>
      )}
      {authType === 'header' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field theme={theme} label="Header Name">
            <input
              value={headerName}
              onChange={(event) => setHeaderName(event.target.value)}
              style={inputStyle(theme)}
            />
          </Field>
          <Field theme={theme} label="Header Value">
            <input
              type="password"
              value={headerValue}
              onChange={(event) => setHeaderValue(event.target.value)}
              style={inputStyle(theme)}
            />
          </Field>
        </div>
      )}
      {testResult && (
        <div
          style={{
            borderRadius: 8,
            padding: '9px 11px',
            color: testResult.ok ? '#22c55e' : '#ef4444',
            border: `1px solid ${testResult.ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
            background: testResult.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            fontSize: 12
          }}
        >
          {testResult.message}
        </div>
      )}
      {error && <InlineError>{error}</InlineError>}
    </Modal>
  )
}

function McpsPanel({
  theme,
  leftSlot
}: {
  theme: Theme
  leftSlot?: ReactNode
}): React.ReactElement {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dialogServer, setDialogServer] = useState<McpServer | null | undefined>(undefined)

  const loadServers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setServers(
        unwrapPaginatedData<McpServer>(
          await desktopAppJson<McpServer[] | { data: McpServer[] }>('/api/v1/mcps')
        )
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load MCP servers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return servers
    return servers.filter(
      (server) =>
        server.name.toLowerCase().includes(q) ||
        server.url.toLowerCase().includes(q) ||
        server.description?.toLowerCase().includes(q)
    )
  }, [servers, search])

  async function toggle(server: McpServer, event: React.MouseEvent): Promise<void> {
    event.stopPropagation()
    const enabled = !server.enabled
    setServers((prev) =>
      prev.map((item) => (item._id === server._id ? { ...item, enabled } : item))
    )
    await desktopAppJson('/api/v1/mcps', {
      method: 'PATCH',
      body: JSON.stringify({ mcpServerId: server._id, enabled })
    }).catch(() => null)
    window.dispatchEvent(new Event('overlay:mcps-changed'))
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header
        title="MCPs"
        theme={theme}
        search={search}
        onSearchChange={setSearch}
        onAdd={() => setDialogServer(null)}
        addLabel="Add Server"
        leftSlot={leftSlot}
      />
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={20} className="animate-spin" color={theme.textSecondary} />
        </div>
      ) : error ? (
        <EmptyState
          theme={theme}
          icon={<Server size={40} strokeWidth={1.2} />}
          title="MCP servers could not load"
          detail={error}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          theme={theme}
          icon={<Server size={40} strokeWidth={1.2} />}
          title="No MCP servers configured"
          detail="Add remote MCP servers to extend the agent with custom tools."
        />
      ) : (
        <div style={{ overflowY: 'auto', padding: 18 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
              gap: 12
            }}
          >
            {filtered.map((server) => (
              <Card key={server._id} theme={theme} onClick={() => setDialogServer(server)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={iconBadgeStyle(theme)}>
                    <Server size={14} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <p style={cardTitleStyle(theme)}>{server.name || 'Untitled'}</p>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: server.enabled ? theme.text : theme.textSecondary
                        }}
                      />
                    </div>
                    <p style={cardDescriptionStyle(theme)}>{server.url}</p>
                    {server.description && (
                      <p style={cardDescriptionStyle(theme)}>{server.description}</p>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <span style={tagStyle(theme)}>{server.transport}</span>
                  {server.hasAuth && <span style={tagStyle(theme)}>Auth</span>}
                </div>
                <div style={cardActionsStyle}>
                  <button
                    type="button"
                    onClick={(event) => void toggle(server, event)}
                    style={iconButtonStyle(theme)}
                  >
                    {server.enabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialogServer(server)}
                    style={iconButtonStyle(theme)}
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
      {dialogServer !== undefined && (
        <McpDialog
          theme={theme}
          server={dialogServer ?? undefined}
          onClose={() => setDialogServer(undefined)}
          onSaved={(server) =>
            setServers((prev) => {
              const idx = prev.findIndex((item) => item._id === server._id)
              if (idx === -1) return [server, ...prev]
              const next = [...prev]
              next[idx] = server
              return next
            })
          }
          onDeleted={(id) => setServers((prev) => prev.filter((server) => server._id !== id))}
        />
      )}
    </div>
  )
}

function Card({
  theme,
  children,
  onClick
}: {
  theme: Theme
  children: ReactNode
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'relative',
        minHeight: 128,
        borderRadius: 10,
        border: `1px solid ${theme.border}`,
        background: theme.surface,
        color: theme.text,
        padding: 14,
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: FONT,
        overflow: 'hidden'
      }}
    >
      {children}
    </button>
  )
}

function EmptyState({
  theme,
  icon,
  title,
  detail
}: {
  theme: Theme
  icon: ReactNode
  title: string
  detail: string
}): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        color: theme.textSecondary,
        textAlign: 'center',
        padding: 24
      }}
    >
      {icon}
      <div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: theme.text }}>{title}</p>
        <p style={{ margin: '5px 0 0', fontSize: 12, color: theme.textSecondary }}>{detail}</p>
      </div>
    </div>
  )
}

const iconBadgeStyle = (theme: Theme): React.CSSProperties => ({
  width: 30,
  height: 30,
  borderRadius: 8,
  background: theme.background,
  color: theme.textSecondary,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0
})

const cardTitleStyle = (theme: Theme): React.CSSProperties => ({
  margin: 0,
  color: theme.text,
  fontSize: 13,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1
})

const cardDescriptionStyle = (theme: Theme): React.CSSProperties => ({
  margin: '3px 0 0',
  color: theme.textSecondary,
  fontSize: 11,
  lineHeight: 1.4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
})

const cardActionsStyle: React.CSSProperties = {
  position: 'absolute',
  right: 10,
  bottom: 10,
  display: 'flex',
  gap: 4
}

const iconButtonStyle = (theme: Theme): React.CSSProperties => ({
  width: 25,
  height: 25,
  border: 'none',
  borderRadius: 6,
  background: theme.background,
  color: theme.textSecondary,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer'
})

const tagStyle = (theme: Theme): React.CSSProperties => ({
  borderRadius: 5,
  border: `1px solid ${theme.border}`,
  padding: '2px 6px',
  color: theme.textSecondary,
  fontSize: 10,
  textTransform: 'uppercase'
})

export function ExtensionsPage({
  theme,
  activeView,
  headerLeftSlot
}: {
  theme: Theme
  activeView: ExtensionView
  headerLeftSlot?: ReactNode
}): React.ReactElement {
  const [connectorsSearch, setConnectorsSearch] = useState('')

  if (activeView === 'skills') return <SkillsPanel theme={theme} leftSlot={headerLeftSlot} />
  if (activeView === 'mcps') return <McpsPanel theme={theme} leftSlot={headerLeftSlot} />

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Header
        title="Connectors"
        theme={theme}
        search={connectorsSearch}
        onSearchChange={setConnectorsSearch}
        leftSlot={headerLeftSlot}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
        <IntegrationsSettings theme={theme} searchQuery={connectorsSearch} />
      </div>
    </div>
  )
}
