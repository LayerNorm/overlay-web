'use client'
import { useState } from 'react'
import { workContextHref } from '../lib/context-href'
import { X, Plus } from 'lucide-react'
import type { WorkContext, WorkScope } from '@overlay/app-core/work'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
export function WorkContextEditor({
  value,
  onChange,
  disabled,
  workspaceId,
  scope,
}: {
  value: WorkContext[]
  onChange: (value: WorkContext[]) => void
  disabled: boolean
  workspaceId: string
  scope: WorkScope
}) {
  const [options, setOptions] = useState<WorkContext[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [url, setUrl] = useState('')
  const add = (ref: WorkContext) => {
    if (!value.some((item) => item.id === ref.id && item.type === ref.type))
      onChange([...value, ref])
  }
  async function load() {
    setLoading(true)
    setError('')
    try {
      setOptions(
        await overlayAppClient.work.context(scope, {
          headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId },
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load context')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="space-y-2">
      {value.map((ref, index) => (
        <div
          key={`${ref.type}:${ref.id}`}
          className="flex items-center gap-2 rounded border border-(--border) px-2 py-1.5 text-xs"
        >
          <span className="text-(--muted)">{ref.type}</span>
          <a
            className="min-w-0 flex-1 truncate underline"
            href={workContextHref(ref, workspaceId)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ref.label}
          </a>
          {!disabled ? (
            <button
              type="button"
              aria-label={`Remove ${ref.label}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      ))}
      {!disabled ? (
        <>
          <button
            type="button"
            onClick={() => {
              void load()
            }}
            disabled={loading}
            className="inline-flex items-center gap-1 text-xs text-(--muted)"
          >
            <Plus size={13} />
            {loading ? 'Loading…' : 'Add a file, note or chat'}
          </button>
          {options ? (
            <select
              aria-label="Context resource"
              value=""
              onChange={(e) => {
                const ref = options[Number(e.target.value)]
                if (ref) add(ref)
              }}
              className="w-full rounded border border-(--border) bg-(--background) p-2 text-xs"
            >
              <option value="">Choose context…</option>
              {options.map((ref, i) => (
                <option key={`${ref.type}:${ref.id}`} value={i}>
                  {ref.type}: {ref.label}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex gap-2">
            <input
              aria-label="Context link"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="min-w-0 flex-1 rounded border border-(--border) bg-transparent px-2 py-1 text-xs"
            />
            <button
              type="button"
              className="text-xs"
              onClick={() => {
                try {
                  const parsed = new URL(url)
                  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error()
                  add({ type: 'link', id: parsed.href, label: parsed.hostname })
                  setUrl('')
                  setError('')
                } catch {
                  setError('Enter an HTTP or HTTPS link')
                }
              }}
            >
              Add link
            </button>
          </div>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  )
}
