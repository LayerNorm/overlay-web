'use client'

import type { McpAuthType,McpTransport } from '@overlay/app-core'
import { Button,Input,Select,Textarea,Toggle } from '@overlay/ui'
import {
LayoutGrid,
Lock
} from 'lucide-react'
import { type ReactNode } from 'react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '../shell'

export function ToolsComingSoonView({ title, icon: Icon }: {
  title: string
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
}) {
  return (
    <AppScreenShell header={<AppScreenHeader title={title} className="px-6" />}>
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full flex-col items-center justify-center gap-4 text-[var(--muted)]">
        <Icon size={40} strokeWidth={1} className="text-[var(--muted-light)] opacity-80" />
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium text-[var(--foreground)]">{title} coming soon</p>
          <p className="text-xs text-[var(--muted-light)]">This feature is under development</p>
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}

export function AppsComingSoonView() {
  return <ToolsComingSoonView title="Apps" icon={Lock} />
}

export function AllExtensionsComingSoonView() {
  return <ToolsComingSoonView title="All Extensions" icon={LayoutGrid} />
}

export interface LegacyMcpServerFormValues {
  name: string
  description?: string
  transport: McpTransport
  url: string
  enabled: boolean
  authType: McpAuthType
  bearerToken?: string
  headerName?: string
  headerValue?: string
  timeoutMs?: number | ''
}

export interface McpServerFormProps {
  value: LegacyMcpServerFormValues
  saving?: boolean
  testing?: boolean
  testResult?: ReactNode
  submitLabel?: ReactNode
  onChange: (value: LegacyMcpServerFormValues) => void
  onSubmit?: () => void
  onTest?: () => void
}

export function McpServerForm({
  value,
  saving,
  testing,
  testResult,
  submitLabel = 'Save server',
  onChange,
  onSubmit,
  onTest,
}: McpServerFormProps) {
  const update = <Key extends keyof LegacyMcpServerFormValues>(key: Key, next: LegacyMcpServerFormValues[Key]) => {
    onChange({ ...value, [key]: next })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit?.()
      }}
    >
      <Input value={value.name} onChange={(event) => update('name', event.target.value)} placeholder="Server name" />
      <Textarea
        value={value.description ?? ''}
        onChange={(event) => update('description', event.target.value)}
        placeholder="Description"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select value={value.transport} onChange={(event) => update('transport', event.target.value as McpTransport)}>
          <option value="streamable-http">Streamable HTTP</option>
          <option value="sse">SSE</option>
        </Select>
        <Select value={value.authType} onChange={(event) => update('authType', event.target.value as McpAuthType)}>
          <option value="none">No auth</option>
          <option value="bearer">Bearer token</option>
          <option value="header">Custom header</option>
        </Select>
      </div>
      <Input value={value.url} onChange={(event) => update('url', event.target.value)} placeholder="https://server.example/mcp" />
      {value.authType === 'bearer' ? (
        <Input
          value={value.bearerToken ?? ''}
          onChange={(event) => update('bearerToken', event.target.value)}
          placeholder="Bearer token"
          type="password"
        />
      ) : null}
      {value.authType === 'header' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input value={value.headerName ?? ''} onChange={(event) => update('headerName', event.target.value)} placeholder="Header name" />
          <Input value={value.headerValue ?? ''} onChange={(event) => update('headerValue', event.target.value)} placeholder="Header value" type="password" />
        </div>
      ) : null}
      <label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm">
        <span>Enabled</span>
        <Toggle checked={value.enabled} onCheckedChange={(checked) => update('enabled', checked)} />
      </label>
      {testResult ? <div className="text-xs text-[var(--muted)]">{testResult}</div> : null}
      <div className="flex items-center justify-end gap-2">
        {onTest ? (
          <Button type="button" variant="ghost" disabled={testing} onClick={onTest}>
            {testing ? 'Testing' : 'Test'}
          </Button>
        ) : null}
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
