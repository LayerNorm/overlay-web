'use client'
import { useState } from 'react'
import { workContextHref } from '../lib/context-href'
import { X, Plus, Link } from 'lucide-react'
import { ListboxSelect } from '@overlay/ui/primitives'
import { workPickerClass } from './StatusPicker'
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
  const [showLink, setShowLink] = useState(false)
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
          <div className="flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => {
                void load()
              }}
              disabled={loading}
              className="inline-flex items-center gap-1 text-xs text-(--muted)"
            >
              <Plus size={13} />
              {loading ? 'Loading…' : 'Add context'}
            </button>
            <button
              type="button"
              onClick={() => setShowLink((open) => !open)}
              aria-expanded={showLink}
              className="inline-flex items-center gap-1 text-xs text-(--muted)"
            >
              <Link size={13} /> Add link
            </button>
          </div>
          {options ? (
            <ListboxSelect
              portal={false}
              aria-label="Context resource"
              value=""
              onChange={(value) => {
                const ref = options.find((ref) => `${ref.type}:${ref.id}` === value)
                if (ref) add(ref)
              }}
              buttonClassName={workPickerClass}
              options={[
                { value: '', label: 'Choose context…' },
                ...options.map((ref) => ({
                  value: `${ref.type}:${ref.id}`,
                  label: ref.label,
                  group: ref.type,
                })),
              ]}
            />
          ) : null}
          {showLink ? (
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
                    add({
                      type: 'link',
                      id: parsed.href,
                      label: parsed.hostname,
                    })
                    setUrl('')
                    setShowLink(false)
                    setError('')
                  } catch {
                    setError('Enter an HTTP or HTTPS link')
                  }
                }}
              >
                Attach
              </button>
            </div>
          ) : null}
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
