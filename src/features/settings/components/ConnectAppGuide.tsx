'use client'

import { useState } from 'react'
import { SegmentedControl } from '@overlay/ui/primitives'
import { McpCopyField } from './McpCopyField'

const APPS = [
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'claude', label: 'Claude' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'codex', label: 'Codex' },
] as const
type AppId = (typeof APPS)[number]['value']

function steps(app: AppId, endpoint: string): { text: string; snippet?: { label: string; value: string; multiline?: boolean } } {
  switch (app) {
    case 'chatgpt':
      return { text: 'In ChatGPT, open Settings → Connectors, turn on developer mode, and add a custom connector. Paste the address above and sign in to Overlay when asked.' }
    case 'claude':
      return { text: 'In Claude, open Settings → Connectors and choose Add custom connector. Paste the address above and sign in to Overlay when asked.' }
    case 'claude-code':
      return {
        text: 'Add the server, then run /mcp inside Claude Code and choose Overlay to sign in.',
        snippet: { label: 'Claude Code command', value: `claude mcp add --transport http overlay ${endpoint}` },
      }
    case 'cursor':
      return {
        text: 'Add this to ~/.cursor/mcp.json. Cursor opens a browser to sign in to Overlay.',
        snippet: { label: 'Cursor config', value: JSON.stringify({ mcpServers: { overlay: { url: endpoint } } }, null, 2), multiline: true },
      }
    case 'codex':
      return {
        text: 'Add the server, then sign in to Overlay.',
        snippet: { label: 'Codex commands', value: `codex mcp add overlay --url ${endpoint}\ncodex mcp login overlay`, multiline: true },
      }
  }
}

/** The address of Overlay's MCP server and how to add it to each app. */
export function ConnectAppGuide({ endpoint }: { endpoint: string }) {
  const [app, setApp] = useState<AppId>('chatgpt')
  const guide = steps(app, endpoint)
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs font-medium text-[var(--foreground)]">Overlay address</p>
        <McpCopyField value={endpoint} label="Overlay MCP address" />
      </div>
      <SegmentedControl ariaLabel="App" layout="stretch" value={app} options={[...APPS]} onChange={setApp} />
      <p className="text-xs leading-5 text-[var(--muted)]">{guide.text}</p>
      {guide.snippet ? <McpCopyField value={guide.snippet.value} label={guide.snippet.label} multiline={guide.snippet.multiline} /> : null}
    </div>
  )
}
