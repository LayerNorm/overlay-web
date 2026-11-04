'use client'

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@overlay/ui/primitives'

import { adminApi } from '@/shared/admin-api'
import type { AdminAuditRow } from '@/shared/admin-types'
import { AdminError, AdminScreen, errorMessage } from '../AdminScreen'

const SEARCH_DELAY_MS = 250

export function AuditPanel() {
  const [events, setEvents] = useState<AdminAuditRow[] | null>(null)
  const [action, setAction] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const exact = action.trim()
    const timer = window.setTimeout(() => {
      adminApi.admin.listAudit(exact ? { action: exact } : {}, { signal: controller.signal })
        .then((rows) => { setEvents(rows); setError(null) })
        .catch((loadError: unknown) => {
          if (!controller.signal.aborted) setError(errorMessage(loadError, 'Failed to load audit events'))
        })
    }, exact ? SEARCH_DELAY_MS : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [action, reloadKey])

  return (
    <AdminScreen title="Audit log" subtitle="Every administrative action" onRefresh={() => setReloadKey((key) => key + 1)}>
      <div className="admin-toolbar">
        <label className="admin-search">
          <Search size={16} strokeWidth={1.6} />
          <Input
            aria-label="Filter by exact action"
            placeholder="Filter by exact action, e.g. administration.roles.update"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
        </label>
      </div>
      <AdminError message={error} />
      <div className="admin-list audit-list" data-testid="admin-audit">
        <div className="admin-list-head">
          <span>Action</span>
          <span className="admin-hide-sm">Resource</span>
          <span>Outcome</span>
          <span className="admin-hide-sm">When</span>
        </div>
        {events === null ? (
          <p className="admin-list-empty">Loading…</p>
        ) : events.length === 0 ? (
          <p className="admin-list-empty">No matching audit events.</p>
        ) : events.map((event) => {
          const allowed = event.outcome === 'success'
          return (
            <div key={event.id} className="admin-list-item">
              <span className="mono truncate" title={event.actorUserId ? `By ${event.actorUserId}` : undefined}>{event.action}</span>
              <span className="admin-muted admin-hide-sm truncate">
                {event.resourceType}{event.resourceId ? ` · ${event.resourceId}` : ''}
              </span>
              <span>
                <span className={`admin-pill ${allowed ? 'ok' : 'no'}`}>
                  <span className="dot" />
                  {allowed ? 'Allowed' : outcomeLabel(event.outcome)}
                </span>
              </span>
              <span className="admin-muted admin-hide-sm">{formatWhen(event.createdAt)}</span>
            </div>
          )
        })}
      </div>
    </AdminScreen>
  )
}

function outcomeLabel(outcome: string): string {
  return outcome === 'denied' ? 'Denied' : outcome === 'failure' ? 'Failed' : outcome
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
