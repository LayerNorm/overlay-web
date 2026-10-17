'use client'

import {useEffect, useEffectEvent, useState, useSyncExternalStore} from 'react'
import {AlertTriangle, Download} from 'lucide-react'
import {publicEnv} from '@/shared/env/public-env'
import {roomMessageDomId} from './room-message-view'
import {recordRemoteUiTrace} from './remote-ui-trace-recorder'
import {openRemoteUiTrace, readRemoteUiTrace} from './remote-ui-trace-store'

const terminalStates = new Set(['completed', 'cancelled', 'failed', 'recoverable'])
const subscribe = (callback: () => void) => {
  window.addEventListener('popstate', callback)
  return () => window.removeEventListener('popstate', callback)
}
const enabledSnapshot = () => publicEnv.agentUiTrace && new URLSearchParams(window.location.search).get('agentUiTrace') === '1'
const serverSnapshot = () => false

export function RemoteRunTrace({runId, messageId, state}: {runId: string; messageId: string; state: string}) {
  const enabled = useSyncExternalStore(subscribe, enabledSnapshot, serverSnapshot)
  const [status, setStatus] = useState<'idle' | 'recording' | 'stopped' | 'error'>('idle')
  const terminal = useEffectEvent(() => terminalStates.has(state))
  const updateStatus = useEffectEvent((next: typeof status) => setStatus(next))
  useEffect(() => {
    if (!enabled || terminal()) return
    return recordRemoteUiTrace({runId, messageId, candidateSha: publicEnv.agentUiTraceSha,
      root: () => document.getElementById(roomMessageDomId(messageId)), terminal, onStatus: updateStatus})
  }, [enabled, runId, messageId])

  async function download() {
    try {
      const database = await openRemoteUiTrace()
      try {
        const rows = await readRemoteUiTrace(database, runId, messageId)
        if (!rows.length) throw new Error('No timing observations')
        const blob = new Blob([rows.map(row => JSON.stringify(row)).join('\n') + '\n'], {type: 'application/x-ndjson'})
        const url = URL.createObjectURL(blob), link = document.createElement('a')
        link.href = url
        link.download = `overlay-ui-trace-${messageId}.jsonl`
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } finally { database.close() }
    } catch { setStatus('error') }
  }
  if (!enabled) return null
  return <button type="button" onClick={() => void download()}
    aria-label={`Export timing trace (${status})`}
    title={status === 'error' ? 'Timing recording failed or unavailable; export is incomplete' : `Export local timing trace (${status})`}
    className="rounded-md p-1.5 text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)">
    {status === 'error' ? <AlertTriangle size={14} strokeWidth={1.75} /> : <Download size={14} strokeWidth={1.75} />}
  </button>
}
