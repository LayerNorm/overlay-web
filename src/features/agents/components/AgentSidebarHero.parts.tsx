'use client'

import { useRef, useState } from 'react'
import { Button, Input } from '@overlay/ui/primitives'
import type { useAgentEditorController } from './AgentEditorPage'
import { AgentAvatarPicker } from './AgentAvatarPicker'

type Controller = ReturnType<typeof useAgentEditorController>

export function AgentSidebarHero({
  editor,
  onBlurSave,
}: {
  editor: Controller
  onBlurSave(): void
}) {
  const { form, agent, isDefaultMaster } = editor
  const name = form.name || agent?.name || 'Agent'
  return {
    avatar: (
      <AgentAvatarPicker
        isDefault={agent?.isDefault}
        shape={form.avatarShape}
        color={form.avatarColor}
        onShapeChange={(shape) => {
          form.setAvatarShape(shape)
          form.markDirty()
        }}
        onColorChange={(color) => {
          form.setAvatarColor(color)
          form.markDirty()
        }}
        size={72}
      />
    ),
    title: isDefaultMaster ? (
      <span>{name}</span>
    ) : (
      <InlineEditor
        ariaLabel="Edit agent name"
        value={name}
        className="text-lg font-medium leading-6 text-(--foreground)"
        onCommit={(value) => {
          form.setName(value)
          form.markDirty()
        }}
        onBlurSave={onBlurSave}
      />
    ),
    titleText: name,
    subtitle: (
      <InlineEditor
        ariaLabel="Edit agent description"
        value={form.description}
        placeholder="Add a description"
        className="text-[13px] leading-5 text-(--muted)"
        onCommit={(value) => {
          form.setDescription(value)
          form.markDirty()
        }}
        onBlurSave={onBlurSave}
      />
    ),
  }
}

function InlineEditor({
  ariaLabel,
  value,
  placeholder,
  className,
  onCommit,
  onBlurSave,
}: {
  ariaLabel: string
  value: string
  placeholder?: string
  className: string
  onCommit(value: string): void
  onBlurSave(): void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const editingRef = useRef(false)

  const begin = () => {
    setDraft(value)
    editingRef.current = true
    setEditing(true)
  }
  const finish = (commit: boolean) => {
    if (!editingRef.current) return
    editingRef.current = false
    setEditing(false)
    if (commit && draft !== value) onCommit(draft)
    if (commit) window.setTimeout(onBlurSave, 0)
  }

  if (!editing) {
    return (
      <Button
        variant="ghost"
        type="button"
        aria-label={ariaLabel}
        onClick={begin}
        className={`group h-auto max-w-full rounded-md px-2 py-0.5 ${className} hover:bg-(--surface-subtle) ${
          !value && placeholder ? 'text-(--muted)' : ''
        }`}
      >
        <span className={!value && placeholder ? 'opacity-70 group-hover:opacity-100' : 'line-clamp-2'}>
          {value || placeholder}
        </span>
      </Button>
    )
  }

  return (
    <Input
      autoFocus
      aria-label={ariaLabel}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          finish(false)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          finish(true)
        }
      }}
      className={`h-auto min-w-0 border-0 bg-transparent px-1 py-0 text-center shadow-none ${className}`}
    />
  )
}
