'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Input, ListboxSelect } from '@overlay/ui/primitives'
import { SettingsActionRow, SettingsGroup } from '@overlay/modules-react/settings'
import { useDesktopBridge } from '@/components/desktop/DesktopProvider'
import type { HostStatus, Model, TranscriptionStatus, UpdateStatus } from '@overlay/desktop-bridge'

export function DesktopSettings() {
  const desktop = useDesktopBridge()
  const [host, setHost] = useState<HostStatus | null>(null)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [transcription, setTranscription] = useState<TranscriptionStatus | null>(null)
  const [models, setModels] = useState<Model[]>([])
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [code, setCode] = useState('')
  const [adapter, setAdapter] = useState<'codex' | 'claude-code'>('codex')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    if (!desktop) return
    const { bridge, info } = desktop
    const tasks = []
    if (info.capabilities.includes('agentHost')) tasks.push(bridge.call('agentHost.status', undefined).then(setHost))
    if (info.capabilities.includes('updates')) tasks.push(bridge.call('updates.status', undefined).then(setUpdate))
    if (info.capabilities.includes('hotkeys')) tasks.push(bridge.call('hotkeys.list', undefined).then(setKeys))
    if (info.capabilities.includes('transcription')) tasks.push(bridge.call('transcription.status', undefined).then(setTranscription), bridge.call('transcription.listModels', undefined).then(setModels))
    await Promise.all(tasks)
  }, [desktop])
  useEffect(() => { void refresh().catch(() => setError('Could not read desktop settings.')) }, [refresh])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); await refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Desktop operation failed.') } finally { setBusy(false) }
  }
  if (!desktop) return null
  const { bridge, info } = desktop
  return <div className="space-y-6">
    <Button size="sm" variant="outline" onClick={() => void run(() => bridge.call('window.openDataFolder', undefined))}>Open local recordings and preserved data</Button>
    <p className="text-sm text-muted-foreground">Overlay for {info.platform === 'darwin' ? 'Mac' : info.platform} · {info.appVersion}</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {info.capabilities.includes('transcription') ? <SettingsGroup>
      <SettingsActionRow icon={null} title="Dictation model" description="Local models run on your Mac, including offline. Cloud dictation uses your Overlay account." action={<ListboxSelect value={transcription?.model ?? 'cloud'} options={[{ value: 'cloud', label: 'Cloud' }, ...models.map((m) => ({ value: m.id, label: m.name }))]} aria-label="Dictation model" disabled={busy} onChange={(model) => void run(() => bridge.call('transcription.configure', { model: model as 'cloud' | 'parakeet_v2' }))} />} />
      {models.map((model) => <SettingsActionRow icon={null} key={model.id} title={model.name} description={model.downloaded ? 'Ready on this Mac' : 'Download to use offline'} action={<Button variant="outline" size="sm" disabled={busy || model.downloaded} onClick={() => void run(() => bridge.call('transcription.downloadModel', { id: model.id as 'parakeet_v2' }))}>{model.downloaded ? 'Downloaded' : 'Download'}</Button>} />)}
      <p className="px-4 pb-3 text-xs text-muted-foreground">Microphone: {transcription?.microphone ?? 'checking'} · Accessibility: {transcription?.accessibility ? 'allowed' : 'enable in System Settings for dictation into other apps'}</p>
    </SettingsGroup> : null}
    {info.capabilities.includes('hotkeys') ? <SettingsGroup>{Object.entries(keys).map(([id, value]) => <SettingsActionRow icon={null} key={id} title={`${id[0].toUpperCase()}${id.slice(1)} shortcut`} description="Use an Electron accelerator, such as CommandOrControl+Shift+Space." action={<div className="flex gap-2"><Input aria-label={`${id} shortcut`} className="w-52" value={value} onChange={(e) => setKeys((old) => ({ ...old, [id]: e.target.value }))} /><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => bridge.call('hotkeys.set', { id: id as 'chat', accelerator: value }))}>Save</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => bridge.call('hotkeys.reset', { id: id as 'chat' }))}>Reset</Button></div>} />)}</SettingsGroup> : null}
    {info.capabilities.includes('panels') ? <SettingsGroup>{(['chat', 'notes'] as const).map((kind) => <SettingsActionRow icon={null} key={kind} title={`${kind === 'chat' ? 'Chat' : 'Notes'} panel`} description="Keep a compact Overlay window over your other apps." action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void run(() => bridge.call('panels.toggle', { kind }))}>Toggle</Button><Button size="sm" variant="ghost" onClick={() => void run(() => bridge.call('panels.setDocked', { kind, edge: 'right' }))}>Dock right</Button><Button size="sm" variant="ghost" onClick={() => void run(() => bridge.call('panels.setDocked', { kind, edge: 'none' }))}>Undock</Button></div>} />)}</SettingsGroup> : null}
    {info.capabilities.includes('agentHost') ? <SettingsGroup><SettingsActionRow icon={null} title="Local Agent Host" description={`State: ${host?.state ?? 'checking'}. Create a connection code in Agents, then start the host on this Mac.`} action={<Button size="sm" variant="outline" disabled={busy || !host || !['running', 'starting'].includes(host.state)} onClick={() => void run(() => bridge.call('agentHost.stop', undefined))}>Stop</Button>} /><div className="flex flex-wrap gap-2 px-4 pb-4"><ListboxSelect value={adapter} options={[{ value: 'codex', label: 'Codex' }, { value: 'claude-code', label: 'Claude Code' }]} onChange={setAdapter} aria-label="Agent adapter" /><Input aria-label="Agent enrollment code" placeholder="Connection code" value={code} onChange={(e) => setCode(e.target.value)} className="w-52" /><Button size="sm" variant="outline" disabled={busy || !code.trim()} onClick={() => void run(async () => { await bridge.call('agentHost.start', { adapter, enrollmentCode: code }); setCode('') })}>Start host</Button></div>{host?.logTail.length ? <pre className="max-h-40 overflow-auto px-4 pb-4 text-xs">{host.logTail.join('\n')}</pre> : null}</SettingsGroup> : null}
    {info.capabilities.includes('updates') ? <SettingsGroup><SettingsActionRow icon={null} title="Updates" description={update?.message ?? update?.state ?? 'Checking'} action={<div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => bridge.call('updates.check', undefined))}>Check for updates</Button>{update?.state === 'downloaded' ? <Button size="sm" onClick={() => void run(() => bridge.call('updates.install', undefined))}>Restart to update</Button> : null}</div>} /></SettingsGroup> : null}
  </div>
}
