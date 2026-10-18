'use client'
import { unstyledInput } from '@overlay/ui/control-reset'
import { Input } from '@overlay/ui/primitives'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { validateWorkTitle } from '@/shared/work/status'
import { useWorkData } from './WorkDataProvider'

export interface WorkQuickAddHandle {
  focus: () => void
}

/** One line to add a task: type a title, press Enter, and it appears in Todo. */
export const WorkQuickAdd = forwardRef<WorkQuickAddHandle, { disabled?: boolean }>(function WorkQuickAdd({ disabled }, ref) {
  const { createTask } = useWorkData()
  const input = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), [])

  async function submit() {
    if (busy || validateWorkTitle(title)) return
    setBusy(true)
    const created = await createTask({ title: title.trim() })
    setBusy(false)
    if (created) setTitle('')
    input.current?.focus()
  }

  return (
    <label className="mx-6 mb-1 mt-3.5 flex h-10 shrink-0 items-center gap-3 rounded-[10px] border border-dashed border-(--border) px-3.5 text-(--muted-light) transition-colors focus-within:border-solid focus-within:border-(--muted-light) focus-within:bg-(--surface-elevated) focus-within:text-(--foreground)">
      <Plus size={15} strokeWidth={1.75} className="shrink-0" aria-hidden />
      <Input
        ref={input}
        aria-label="Add a task"
        value={title}
        disabled={disabled}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          } else if (event.key === 'Escape') {
            setTitle('')
            event.currentTarget.blur()
          }
        }}
        placeholder="Add a task and press Enter"
        className={unstyledInput(`min-w-0 flex-1 border-0 bg-transparent text-sm text-(--foreground) outline-none placeholder:text-(--muted-light)`)}
        data-testid="work-quick-add"
      />
    </label>
  )
})
