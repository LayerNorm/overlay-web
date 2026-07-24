import { useState, useEffect, useCallback, ReactElement } from 'react'
import { X, FileText, Zap, ToggleLeft, ToggleRight, ChevronDown, ChevronUp } from 'lucide-react'
import { Theme } from '../../utils/theme'
import { SettingsRow } from '../ui/SettingsRow'
import {
  ensureSkillsFolder,
  moveNoteToFolder,
  SKILLS_FOLDER_ID,
  getSkillNoteIds,
  createDefaultSkillMetadata,
  type SkillMetadata
} from '../../utils/folderStorage'

interface SkillsSettingsProps {
  theme: Theme
}

interface LoadedSkill {
  id: string
  title: string
  content: string
  updatedAt: number
  skill: SkillMetadata | null
}

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'

function markdownToHtml(md: string): string {
  const lines = md.split('\n')
  const parts: string[] = []
  let inOrderedList = false
  let inUnorderedList = false

  const closeLists = (): void => {
    if (inOrderedList) { parts.push('</ol>'); inOrderedList = false }
    if (inUnorderedList) { parts.push('</ul>'); inUnorderedList = false }
  }

  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const inline = (s: string): string =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line) { closeLists(); continue }
    const h1 = line.match(/^# (.+)/); if (h1) { closeLists(); parts.push(`<h1>${inline(h1[1])}</h1>`); continue }
    const h2 = line.match(/^## (.+)/); if (h2) { closeLists(); parts.push(`<h2>${inline(h2[1])}</h2>`); continue }
    const h3 = line.match(/^### (.+)/); if (h3) { closeLists(); parts.push(`<h3>${inline(h3[1])}</h3>`); continue }
    const ol = line.match(/^\d+\.\s+(.+)/)
    if (ol) {
      if (inUnorderedList) { parts.push('</ul>'); inUnorderedList = false }
      if (!inOrderedList) { parts.push('<ol>'); inOrderedList = true }
      parts.push(`<li>${inline(ol[1])}</li>`)
      continue
    }
    const ul = line.match(/^[-*]\s+(.+)/)
    if (ul) {
      if (inOrderedList) { parts.push('</ol>'); inOrderedList = false }
      if (!inUnorderedList) { parts.push('<ul>'); inUnorderedList = true }
      parts.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    closeLists()
    parts.push(`<p>${inline(line)}</p>`)
  }
  closeLists()
  return parts.join('')
}

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1>(.*?)<\/h1>/gi, '# $1\n')
    .replace(/<h2>(.*?)<\/h2>/gi, '## $1\n')
    .replace(/<h3>(.*?)<\/h3>/gi, '### $1\n')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/<li>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<\/?(?:ol|ul|p)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function SkillChip({
  label,
  onRemove,
  theme
}: {
  label: string
  onRemove: () => void
  theme: Theme
}): ReactElement {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 20,
        background: theme.buttonBg,
        color: theme.toggleThumb,
        fontSize: 11,
        fontWeight: 500,
        fontFamily: FONT
      }}
    >
      {label}
      <button
        onClick={onRemove}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          lineHeight: 1,
          color: 'inherit',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center'
        }}
      >
        ×
      </button>
    </span>
  )
}

export function SkillsSettings({ theme }: SkillsSettingsProps): ReactElement {
  const [skills, setSkills] = useState<LoadedSkill[]>([])
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingSkill, setEditingSkill] = useState<LoadedSkill | null>(null)
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null)

  // Form state
  const [formTitle, setFormTitle] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formTriggerInput, setFormTriggerInput] = useState('')
  const [formTriggers, setFormTriggers] = useState<string[]>([])
  const [formContent, setFormContent] = useState('')
  const [formStatus, setFormStatus] = useState<'draft' | 'active' | 'archived'>('active')
  const [formEnabled, setFormEnabled] = useState(true)

  const loadSkills = useCallback(async () => {
    const skillNoteIds = getSkillNoteIds()
    const loaded: LoadedSkill[] = []
    for (const id of skillNoteIds) {
      try {
        const note = await window.bridge.loadNote(id)
        if (note) {
          loaded.push({
            id: note.id,
            title: note.title,
            content: note.content,
            updatedAt: note.updatedAt,
            skill: (note.skill as SkillMetadata | undefined) ?? null
          })
        }
      } catch {
        // skip
      }
    }
    setSkills(loaded.sort((a, b) => b.updatedAt - a.updatedAt))
  }, [])

  useEffect(() => {
    ensureSkillsFolder()
    loadSkills()
  }, [loadSkills])

  const resetForm = (): void => {
    setFormTitle('')
    setFormDescription('')
    setFormTriggerInput('')
    setFormTriggers([])
    setFormContent('')
    setFormStatus('active')
    setFormEnabled(true)
  }

  const openCreateDialog = (): void => {
    resetForm()
    setEditingSkill(null)
    setShowCreateDialog(true)
  }

  const openEditDialog = (skill: LoadedSkill): void => {
    setEditingSkill(skill)
    setFormTitle(skill.title)
    setFormDescription(skill.skill?.description ?? '')
    setFormTriggers(skill.skill?.triggers ?? [])
    setFormTriggerInput('')
    // Convert HTML content to markdown for editing in textarea
    setFormContent(htmlToMarkdown(skill.content))
    setFormStatus(skill.skill?.status ?? 'active')
    setFormEnabled(skill.skill?.enabled !== false)
    setShowCreateDialog(true)
  }

  const closeDialog = (): void => {
    setShowCreateDialog(false)
    setEditingSkill(null)
    resetForm()
  }

  const addTrigger = (): void => {
    const val = formTriggerInput.trim()
    if (val && !formTriggers.includes(val)) {
      setFormTriggers((prev) => [...prev, val])
    }
    setFormTriggerInput('')
  }

  const removeTrigger = (t: string): void => {
    setFormTriggers((prev) => prev.filter((x) => x !== t))
  }

  const handleSave = async (): Promise<void> => {
    if (!formTitle.trim()) return

    const existingSkill = editingSkill?.skill
    const skillMeta = createDefaultSkillMetadata({
      ...(existingSkill ?? {}),
      description: formDescription.trim(),
      triggers: formTriggers,
      status: formStatus,
      enabled: formEnabled,
      version: (existingSkill?.version ?? 0) + (editingSkill ? 1 : 0)
    })

    if (editingSkill) {
      // Preserve previous version
      const prevVersions = existingSkill?.previousVersions ?? []
      if (existingSkill) {
        prevVersions.push({ content: editingSkill.content, updatedAt: editingSkill.updatedAt })
      }
      skillMeta.previousVersions = prevVersions.slice(-5)
    }

    const id = editingSkill?.id ?? `skill-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    // Convert markdown textarea content to HTML for TipTap rendering
    const htmlContent = markdownToHtml(formContent)
    await window.bridge.saveNote({
      id,
      title: formTitle.trim(),
      content: htmlContent,
      folderId: SKILLS_FOLDER_ID,
      skill: skillMeta as unknown as Record<string, unknown>
    })
    if (!editingSkill) {
      moveNoteToFolder(id, SKILLS_FOLDER_ID)
    }
    closeDialog()
    loadSkills()
  }

  const handleToggleEnabled = async (skill: LoadedSkill): Promise<void> => {
    const updated = createDefaultSkillMetadata({
      ...(skill.skill ?? {}),
      enabled: !(skill.skill?.enabled !== false)
    })
    if (skill.skill?.previousVersions) updated.previousVersions = skill.skill.previousVersions
    await window.bridge.saveNote({
      id: skill.id,
      title: skill.title,
      content: skill.content,  // already HTML — no conversion needed
      skill: updated as unknown as Record<string, unknown>
    })
    loadSkills()
  }

  const handleDelete = async (id: string): Promise<void> => {
    await window.bridge.deleteNote(id)
    // Also clean up the localStorage folder map so the deleted skill
    // doesn't linger as a broken reference
    const { loadNoteFolderMap, saveNoteFolderMap } = await import('../../utils/folderStorage')
    const map = loadNoteFolderMap()
    if (id in map) {
      const { [id]: _removed, ...rest } = map
      saveNoteFolderMap(rest)
    }
    loadSkills()
  }

  const formatDate = (ts: number): string =>
    new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div>
      <SettingsRow
        title="Agent Skills"
        description="Save reusable step-by-step procedures the agent will follow"
        theme={theme}
      >
        <button
          onClick={openCreateDialog}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 500,
            fontFamily: FONT,
            color: theme.toggleThumb,
            background: theme.buttonBg,
            border: 'none',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.buttonHover
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = theme.buttonBg
          }}
        >
          Add
        </button>
      </SettingsRow>

      {skills.map((skill) => {
        const isExpanded = expandedSkillId === skill.id
        const isEnabled = skill.skill?.enabled !== false
        const status = skill.skill?.status ?? 'active'
        return (
          <div
            key={skill.id}
            style={{
              borderBottom: `1px solid ${theme.border}`
            }}
          >
            {/* Row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '14px 0',
                cursor: 'pointer'
              }}
              onClick={() => setExpandedSkillId(isExpanded ? null : skill.id)}
            >
              <FileText size={13} color={theme.textSecondary} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 2
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: isEnabled ? theme.text : theme.textSecondary,
                      fontFamily: FONT,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {skill.title}
                  </span>
                  {status !== 'active' && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: theme.textSecondary,
                        textTransform: 'uppercase',
                        letterSpacing: '0.4px',
                        fontFamily: FONT
                      }}
                    >
                      {status}
                    </span>
                  )}
                </div>
                {skill.skill?.description && (
                  <div
                    style={{
                      fontSize: 11,
                      color: theme.textSecondary,
                      fontFamily: FONT,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {skill.skill.description}
                  </div>
                )}
              </div>

              {/* Toggle enabled */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void handleToggleEnabled(skill)
                }}
                title={isEnabled ? 'Disable skill' : 'Enable skill'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  color: isEnabled ? theme.buttonBg : theme.textSecondary,
                  flexShrink: 0
                }}
              >
                {isEnabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  openEditDialog(skill)
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: theme.textSecondary,
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: FONT,
                  padding: '2px 6px',
                  flexShrink: 0
                }}
              >
                Edit
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDelete(skill.id)
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: theme.textSecondary,
                  fontSize: 12,
                  fontFamily: FONT,
                  padding: '2px 6px',
                  textDecoration: 'underline',
                  flexShrink: 0
                }}
              >
                Remove
              </button>

              {isExpanded ? (
                <ChevronUp size={12} color={theme.textSecondary} style={{ flexShrink: 0 }} />
              ) : (
                <ChevronDown size={12} color={theme.textSecondary} style={{ flexShrink: 0 }} />
              )}
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div
                style={{
                  paddingBottom: 14,
                  paddingLeft: 23,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                {skill.skill?.triggers && skill.skill.triggers.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: theme.textSecondary,
                        textTransform: 'uppercase',
                        letterSpacing: '0.4px',
                        marginBottom: 4,
                        fontFamily: FONT
                      }}
                    >
                      Triggers
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {skill.skill.triggers.map((t) => (
                        <span
                          key={t}
                          style={{
                            padding: '2px 8px',
                            borderRadius: 20,
                            background: theme.surface ?? theme.border,
                            color: theme.textSecondary,
                            fontSize: 11,
                            fontFamily: FONT
                          }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div
                  style={{
                    fontSize: 11,
                    color: theme.textSecondary,
                    fontFamily: FONT,
                    display: 'flex',
                    gap: 16
                  }}
                >
                  {skill.skill && (
                    <>
                      <span>
                        <Zap size={10} style={{ marginRight: 3 }} />
                        Used {skill.skill.usageCount ?? 0} time{skill.skill.usageCount !== 1 ? 's' : ''}
                      </span>
                      <span>Updated {formatDate(skill.updatedAt)}</span>
                      <span>Source: {skill.skill.source?.kind ?? 'manual'}</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Create / Edit dialog */}
      {(showCreateDialog || editingSkill) && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={closeDialog}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 520,
              maxHeight: '85vh',
              background: theme.modalBackground,
              borderRadius: 16,
              border: `1px solid ${theme.modalBorder}`,
              boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '18px 22px',
                borderBottom: `1px solid ${theme.modalBorder}`
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 600, color: theme.text, fontFamily: FONT }}>
                {editingSkill ? 'Edit Skill' : 'Create Skill'}
              </span>
              <button
                onClick={closeDialog}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <X size={17} color={theme.textSecondary} />
              </button>
            </div>

            {/* Body */}
            <div
              style={{
                padding: '20px 22px',
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 16
              }}
            >
              {/* Title */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6, fontFamily: FONT }}>
                  Skill Name *
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g., Send weekly report email"
                  style={inputStyle(theme)}
                />
              </div>

              {/* Description */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6, fontFamily: FONT }}>
                  Description
                </label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="One-line summary of what this skill does"
                  style={inputStyle(theme)}
                />
              </div>

              {/* Triggers */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6, fontFamily: FONT }}>
                  Trigger Keywords
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                  {formTriggers.map((t) => (
                    <SkillChip key={t} label={t} onRemove={() => removeTrigger(t)} theme={theme} />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={formTriggerInput}
                    onChange={(e) => setFormTriggerInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        addTrigger()
                      }
                    }}
                    placeholder="Type a keyword and press Enter"
                    style={{ ...inputStyle(theme), flex: 1 }}
                  />
                  <button
                    onClick={addTrigger}
                    style={{
                      padding: '9px 14px',
                      borderRadius: 10,
                      border: 'none',
                      background: theme.buttonBg,
                      color: theme.toggleThumb,
                      fontSize: 12,
                      cursor: 'pointer',
                      fontFamily: FONT,
                      flexShrink: 0
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Status */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6, fontFamily: FONT }}>
                  Status
                </label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as 'draft' | 'active' | 'archived')}
                  style={{
                    ...inputStyle(theme),
                    cursor: 'pointer'
                  }}
                >
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </select>
              </div>

              {/* Enabled toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, color: theme.text, fontFamily: FONT, flex: 1 }}>
                  Enabled
                </span>
                <button
                  onClick={() => setFormEnabled((v) => !v)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    color: formEnabled ? theme.buttonBg : theme.textSecondary,
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  {formEnabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                </button>
              </div>

              {/* Procedure */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6, fontFamily: FONT }}>
                  Procedure (Markdown)
                </label>
                <textarea
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder="Write step-by-step instructions the agent should follow..."
                  style={{
                    width: '100%',
                    height: 180,
                    padding: '10px 13px',
                    borderRadius: 10,
                    border: `1px solid ${theme.modalBorder}`,
                    background: theme.surface,
                    color: theme.text,
                    fontSize: 12,
                    lineHeight: 1.5,
                    outline: 'none',
                    resize: 'vertical',
                    fontFamily: 'ui-monospace, monospace',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                padding: '14px 22px',
                borderTop: `1px solid ${theme.modalBorder}`
              }}
            >
              <button
                onClick={closeDialog}
                style={{
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'transparent',
                  color: theme.text,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: FONT
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.border
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={!formTitle.trim()}
                style={{
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: formTitle.trim() ? theme.buttonBg : theme.border,
                  color: formTitle.trim() ? theme.toggleThumb : theme.textDisabled,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: formTitle.trim() ? 'pointer' : 'not-allowed',
                  fontFamily: FONT
                }}
                onMouseEnter={(e) => {
                  if (formTitle.trim()) e.currentTarget.style.background = theme.buttonHover
                }}
                onMouseLeave={(e) => {
                  if (formTitle.trim()) e.currentTarget.style.background = theme.buttonBg
                }}
              >
                {editingSkill ? 'Save Changes' : 'Create Skill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function inputStyle(theme: Theme): React.CSSProperties {
  return {
    width: '100%',
    padding: '9px 13px',
    borderRadius: 10,
    border: `1px solid ${theme.modalBorder}`,
    background: theme.surface,
    color: theme.text,
    fontSize: 13,
    outline: 'none',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxSizing: 'border-box'
  }
}
