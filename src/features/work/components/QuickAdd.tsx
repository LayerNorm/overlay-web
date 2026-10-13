'use client'
import { useState, type RefObject } from 'react'
import { Plus } from 'lucide-react'
export function QuickAdd({ pending, disabled, inputRef, onCreate }: { pending: boolean; disabled?: boolean; inputRef?: RefObject<HTMLInputElement | null>; onCreate: (title: string) => Promise<unknown> }) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  return <div><form className="mx-6 my-4 flex min-h-10 items-center gap-3 rounded-lg border border-dashed border-(--border) px-3 focus-within:border-solid" onSubmit={async (event) => {
    event.preventDefault(); if (!title.trim() || pending) return
    setError(null)
    try { await onCreate(title.trim()); setTitle('') } catch (error) { setError(error instanceof Error ? error.message : 'Could not create task.') }
  }}>
    <Plus size={16} className="shrink-0 text-(--muted)" />
    <input ref={inputRef} value={title} onChange={(event) => setTitle(event.target.value)} aria-label="New task title" placeholder="Add a task…" maxLength={200} disabled={disabled || pending} className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-hidden placeholder:text-(--muted-light)" />
    {title ? <button type="submit" disabled={!title.trim() || disabled || pending} className="rounded-md bg-(--surface-subtle) px-3 py-1.5 text-xs disabled:opacity-50">{pending ? 'Adding…' : 'Add'}</button> : null}
  </form>{error ? <p role="alert" className="mx-6 mb-3 text-xs text-red-600 dark:text-red-400">{error}</p> : null}</div>
}
