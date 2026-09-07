import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { Theme } from '../utils/theme'
import { useAppBootstrap } from '../contexts/AppBootstrapContext'
import { useEnvironments } from '../contexts/EnvironmentContext'
import {
  archiveAgent,
  availableByoHarnesses,
  buildAgentInput,
  createAgent,
  defaultWorkingDirectory,
  disableBindings,
  environmentSupportsHarness,
  getAgent,
  isAgentEditorValid,
  updateAgent,
  upsertBinding,
  type AgentType,
  type DesktopAgentDirectoryItem
} from '../services/environment-service'

interface AgentEditorPanelProps {
  theme: Theme
  mode: 'new' | 'edit'
  agentId?: string
  headerLeftSlot?: ReactNode
  onClose: () => void
  onSaved: (agentId: string) => void
}

const inputStyle = (theme: Theme): React.CSSProperties => ({
  width: '100%',
  borderRadius: '8px',
  border: `1px solid ${theme.border}`,
  background: theme.background,
  color: theme.text,
  padding: '8px 12px',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'system-ui, -apple-system, sans-serif'
})

const labelStyle = (theme: Theme): React.CSSProperties => ({
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: theme.text,
  marginBottom: '6px'
})

export function AgentEditorPanel({
  theme,
  mode,
  agentId,
  headerLeftSlot,
  onClose,
  onSaved
}: AgentEditorPanelProps): ReactElement<any> {
  const { chatModels } = useAppBootstrap()
  const { environments, bindingByAgentId, refresh } = useEnvironments()

  const [agent, setAgent] = useState<DesktopAgentDirectoryItem | null>(null)
  const [loading, setLoading] = useState(mode === 'edit')
  const [loadFailed, setLoadFailed] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [modelId, setModelId] = useState('openrouter/free')
  const [visibility, setVisibility] = useState<'creator' | 'workspace'>('creator')
  const [agentType, setAgentType] = useState<AgentType>('overlay')
  const [adapterId, setAdapterId] = useState('codex')
  const [environmentId, setEnvironmentId] = useState('')
  const [workingDirectory, setWorkingDirectory] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [confirmingArchive, setConfirmingArchive] = useState(false)

  const enabledModels = useMemo(
    () => chatModels.filter((model) => !model.disabled),
    [chatModels]
  )

  useEffect(() => {
    if (mode === 'new' || !agentId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    void getAgent(agentId).then(
      (loaded) => {
        if (cancelled) return
        setAgent(loaded)
        setLoading(false)
      },
      () => {
        if (cancelled) return
        setLoadFailed(true)
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [mode, agentId])

  // Reset the form whenever the loaded agent changes (initial load, save).
  useEffect(() => {
    if (!agent) return
    setName(agent.name)
    setDescription(agent.description ?? '')
    setInstructions(agent.instructions)
    setModelId(agent.modelId || 'openrouter/free')
    setVisibility(agent.visibility)
    setSavedFlash(false)
  }, [agent])

  // Seed the BYO binding from the active binding when editing.
  useEffect(() => {
    if (!agent) return
    const binding = bindingByAgentId.get(agent.id)
    if (!binding) return
    const bindingAdapterId =
      typeof binding.adapterConfig.adapterId === 'string'
        ? binding.adapterConfig.adapterId
        : 'codex'
    setAgentType('byo')
    setAdapterId(bindingAdapterId)
    setEnvironmentId(binding.environmentId)
    setWorkingDirectory(
      typeof binding.adapterConfig.workingDirectory === 'string'
        ? binding.adapterConfig.workingDirectory
        : ''
    )
  }, [agent, bindingByAgentId])

  const harnessOptions = useMemo(() => availableByoHarnesses(environments), [environments])
  const compatibleEnvironments = useMemo(
    () =>
      environments.filter(
        (environment) =>
          environment.status !== 'pending' &&
          environment.status !== 'revoked' &&
          environmentSupportsHarness(environment, adapterId)
      ),
    [environments, adapterId]
  )
  const bindingValid = Boolean(environmentId && adapterId && workingDirectory.trim())
  const valid = isAgentEditorValid({ name, instructions, modelId, agentType, bindingValid })

  const save = async (): Promise<void> => {
    const selectedHarness = harnessOptions.find((harness) => harness.id === adapterId)
    const input = buildAgentInput({
      name,
      description,
      instructions,
      agentType,
      harnessLabel: selectedHarness?.label ?? adapterId,
      adapterId,
      modelId,
      visibility
    })
    const binding =
      agentType === 'byo'
        ? { environmentId, adapterId, workingDirectory: workingDirectory.trim() }
        : agent
          ? null
          : undefined
    setBusy(true)
    setError(null)
    setSavedFlash(false)
    try {
      const creating = !agent
      const saved = agent
        ? await updateAgent(agent.id, input)
        : await createAgent(input)
      if (binding) {
        try {
          await upsertBinding({ agentId: saved.id, ...binding })
        } catch (bindingError) {
          // Identity is durable even when the binding fails: stay in the
          // editor so a retry never creates a duplicate.
          setAgent(saved)
          throw bindingError
        }
      } else if (binding === null && agent) {
        await disableBindings(saved.id)
      }
      await refresh()
      if (creating) onSaved(saved.id)
      else {
        setAgent(saved)
        setSavedFlash(true)
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save agent.')
    } finally {
      setBusy(false)
    }
  }

  const archive = async (): Promise<void> => {
    if (!agent || busy) return
    setBusy(true)
    setError(null)
    try {
      await archiveAgent(agent.id)
      await refresh()
      onClose()
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Could not archive agent.')
    } finally {
      setBusy(false)
      setConfirmingArchive(false)
    }
  }

  if (loading) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          color: theme.textSecondary,
          fontSize: '13px'
        }}
      >
        <Loader2 size={15} className="animate-spin" /> Loading agent…
      </div>
    )
  }

  if (loadFailed) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          color: theme.textSecondary,
          fontSize: '13px'
        }}
      >
        Could not load this agent.
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '7px 14px',
            borderRadius: '8px',
            border: `1px solid ${theme.border}`,
            background: 'transparent',
            color: theme.text,
            fontSize: '12px',
            cursor: 'pointer'
          }}
        >
          Back to agents
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        padding: '40px 60px 80px 40px',
        boxSizing: 'border-box'
      }}
    >
      <div style={{ maxWidth: '640px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {headerLeftSlot}
          <h1
            style={{
              margin: 0,
              flex: 1,
              color: theme.text,
              fontSize: '22px',
              fontWeight: 600,
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            }}
          >
            {agent ? 'Edit agent' : 'New agent'}
          </h1>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: theme.textSecondary,
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !valid}
            onClick={() => void save()}
            style={{
              padding: '7px 16px',
              borderRadius: '8px',
              border: 'none',
              background: theme.text,
              color: theme.background,
              fontSize: '12px',
              fontWeight: 600,
              cursor: busy || !valid ? 'default' : 'pointer',
              opacity: busy || !valid ? 0.5 : 1
            }}
          >
            {busy ? 'Saving…' : agent ? 'Save' : 'Create agent'}
          </button>
        </div>

        {savedFlash && (
          <div style={{ marginTop: '12px', fontSize: '12px', color: '#22c55e' }}>Saved.</div>
        )}
        {error && (
          <div role="alert" style={{ marginTop: '12px', fontSize: '12px', color: '#ef4444' }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={labelStyle(theme)} htmlFor="agent-name">
              Name
            </label>
            <input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Research helper"
              style={inputStyle(theme)}
            />
          </div>

          <div>
            <label style={labelStyle(theme)} htmlFor="agent-description">
              Description <span style={{ fontWeight: 400, color: theme.textSecondary }}>(optional)</span>
            </label>
            <input
              id="agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this agent is for"
              style={inputStyle(theme)}
            />
          </div>

          <div>
            <span style={labelStyle(theme)}>Type</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(
                [
                  { id: 'overlay', label: 'Overlay agent' },
                  { id: 'byo', label: 'Bring your own agent' }
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setAgentType(option.id)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: '9999px',
                    border: `1px solid ${agentType === option.id ? theme.text : theme.border}`,
                    background: agentType === option.id ? theme.text : 'transparent',
                    color: agentType === option.id ? theme.background : theme.text,
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {agentType === 'overlay' ? (
            <>
              <div>
                <label style={labelStyle(theme)} htmlFor="agent-instructions">
                  Instructions
                </label>
                <textarea
                  id="agent-instructions"
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder="How this agent should behave…"
                  rows={6}
                  style={{ ...inputStyle(theme), resize: 'vertical', lineHeight: '18px' }}
                />
              </div>
              <div>
                <label style={labelStyle(theme)} htmlFor="agent-model">
                  Model
                </label>
                <select
                  id="agent-model"
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  style={inputStyle(theme)}
                >
                  {enabledModels.length === 0 && <option value={modelId}>{modelId}</option>}
                  {enabledModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span style={labelStyle(theme)}>Visibility</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(
                    [
                      { id: 'creator', label: 'Creator only' },
                      { id: 'workspace', label: 'Workspace' }
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setVisibility(option.id)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '9999px',
                        border: `1px solid ${visibility === option.id ? theme.text : theme.border}`,
                        background: visibility === option.id ? theme.text : 'transparent',
                        color: visibility === option.id ? theme.background : theme.text,
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer'
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div
              style={{
                padding: '16px',
                borderRadius: '10px',
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '14px'
              }}
            >
              <div>
                <span style={labelStyle(theme)}>Harness</span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {harnessOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      title={option.description}
                      onClick={() => {
                        setAdapterId(option.id)
                        setEnvironmentId('')
                        setWorkingDirectory('')
                      }}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '9999px',
                        border: `1px solid ${adapterId === option.id ? theme.text : theme.border}`,
                        background: adapterId === option.id ? theme.text : 'transparent',
                        color: adapterId === option.id ? theme.background : theme.text,
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer'
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={labelStyle(theme)} htmlFor="agent-environment">
                  Environment
                </label>
                {compatibleEnvironments.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '12px', color: theme.textSecondary, lineHeight: '18px' }}>
                    No connected environment advertises this harness yet. Connect one in
                    Settings → workspace first.
                  </p>
                ) : (
                  <select
                    id="agent-environment"
                    value={environmentId}
                    onChange={(event) => {
                      const nextId = event.target.value
                      setEnvironmentId(nextId)
                      setWorkingDirectory(
                        defaultWorkingDirectory(
                          environments.find((candidate) => candidate.id === nextId)
                        )
                      )
                    }}
                    style={inputStyle(theme)}
                  >
                    <option value="">Choose an environment…</option>
                    {compatibleEnvironments.map((environment) => (
                      <option key={environment.id} value={environment.id}>
                        {environment.name} · {environment.status}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label style={labelStyle(theme)} htmlFor="agent-workdir">
                  Default working directory
                </label>
                <input
                  id="agent-workdir"
                  value={workingDirectory}
                  onChange={(event) => setWorkingDirectory(event.target.value)}
                  placeholder="/Users/you/Projects/app"
                  style={{ ...inputStyle(theme), fontFamily: 'ui-monospace, monospace' }}
                />
                <p style={{ margin: '6px 0 0', fontSize: '11px', color: theme.textSecondary }}>
                  Must be inside the environment&apos;s approved roots.
                </p>
              </div>
            </div>
          )}

          {agent && (
            <div
              style={{
                marginTop: '8px',
                paddingTop: '16px',
                borderTop: `1px solid ${theme.border}`
              }}
            >
              {!confirmingArchive ? (
                <button
                  type="button"
                  onClick={() => setConfirmingArchive(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ef4444',
                    fontSize: '12px',
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  Archive agent
                </button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <span style={{ color: theme.textSecondary }}>
                    Archive {agent.name}? History remains, rooms and teams lose it.
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void archive()}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      background: 'rgba(239,68,68,0.16)',
                      color: '#ef4444',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingArchive(false)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: theme.textSecondary,
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
