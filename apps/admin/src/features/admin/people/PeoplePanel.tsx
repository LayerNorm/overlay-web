'use client'

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@overlay/ui/primitives'

import { adminApi } from '@/shared/admin-api'
import type { AdminUsageRow } from '@/shared/admin-types'
import { AdminError, AdminScreen, errorMessage } from '../AdminScreen'
import { initials, relativeDay, shortDate } from './people-view'

const SEARCH_DELAY_MS = 250

export function PeoplePanel() {
  const [people, setPeople] = useState<AdminUsageRow[] | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const query = search.trim()
    const timer = window.setTimeout(() => {
      adminApi.admin.listUsage(query ? { q: query } : {}, { signal: controller.signal })
        .then((rows) => {
          setPeople(rows)
          setError(null)
        })
        .catch((loadError: unknown) => {
          if (!controller.signal.aborted) setError(errorMessage(loadError, 'Failed to load people'))
        })
    }, query ? SEARCH_DELAY_MS : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [reloadKey, search])

  return (
    <AdminScreen title="People" subtitle="Newest sign-ups first" onRefresh={() => setReloadKey((key) => key + 1)}>
      <div className="admin-toolbar">
        <label className="admin-search">
          <Search size={16} strokeWidth={1.6} />
          <Input
            aria-label="Search people"
            placeholder="Search by name, email or user ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <AdminError message={error} />
      <div className="admin-list people-list" data-testid="admin-usage">
        <div className="admin-list-head">
          <span>Person</span>
          <span className="admin-hide-sm">Signed up</span>
          <span className="admin-hide-sm" title="Latest day of human activity, counted nightly">Last active</span>
          <span>Plan</span>
        </div>
        {people === null ? (
          <p className="admin-list-empty">Loading…</p>
        ) : people.length === 0 ? (
          <p className="admin-list-empty">{search.trim() ? 'Nobody matches that search.' : 'No people yet.'}</p>
        ) : people.map((person) => (
          <div key={person.userId} className="admin-list-item">
            <div className="person">
              <div className="admin-avatar" aria-hidden>{initials(person.name, person.email)}</div>
              <div className="person-text">
                <div className="person-name">{person.name ?? person.email ?? person.userId}</div>
                <div className="person-sub">
                  {person.name && person.email ? <span className="email">{person.email}</span> : null}
                  {person.name && person.email ? <span className="dot">·</span> : null}
                  <span className="mono">{person.userId}</span>
                </div>
              </div>
            </div>
            <span className="admin-muted admin-hide-sm">{person.createdAt ? shortDate(person.createdAt) : '—'}</span>
            <span className="admin-muted admin-hide-sm">{person.lastActiveDay ? relativeDay(person.lastActiveDay) : '—'}</span>
            <span><span className="admin-pill">{person.plan === 'paid' ? 'Paid' : 'Free'}</span></span>
          </div>
        ))}
      </div>
    </AdminScreen>
  )
}
