import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Plus,
  Send,
  Sparkles,
  Square,
  Video,
  X,
} from 'lucide-react'
import type { AttachmentDraft, GenerationMode } from '@overlay/chat-core'
import { CollapsibleGenerationMode } from './GenerationModeToggle'

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

function formatSize(sizeBytes?: number): string {
  if (!sizeBytes) return ''
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(0)} KB`
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
}

interface ChatComposerProps {
  /** Act approval / posture control — rendered above the textarea. */
  toolbarAboveTextarea?: ReactNode
  attachments: AttachmentDraft[]
  onAddFiles: (files: File[]) => void
  onRemoveAttachment: (id: string) => void
  generationMode: GenerationMode
  onGenerationModeChange: (mode: GenerationMode) => void
  value: string
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  canStop?: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onStop?: () => void
  /** Optional voice dictation (extension). */
  voiceEnabled?: boolean
  isRecording?: boolean
  transcribing?: boolean
  onVoiceStart?: () => void
  onVoiceStop?: () => void
}

export function ChatComposer({
  toolbarAboveTextarea,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  generationMode,
  onGenerationModeChange,
  value,
  placeholder,
  disabled,
  loading,
  canStop,
  onChange,
  onSubmit,
  onStop,
  voiceEnabled = false,
  isRecording = false,
  transcribing = false,
  onVoiceStart,
  onVoiceStop,
}: ChatComposerProps) {
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const docInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!attachMenuOpen) return
    function onDoc(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAttachMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [attachMenuOpen])

  const canSend =
    generationMode === 'text'
      ? Boolean(value.trim())
      : Boolean(value.trim()) /* image/video: same gate; paid check is in parent */

  return (
    <div className="shrink-0 px-3 pb-3 sm:px-4 sm:pb-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const files = Array.from(e.dataTransfer.files || [])
          if (files.length > 0) onAddFiles(files)
        }}
        className={`overflow-visible rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
          dragOver ? 'ring-2 ring-[var(--foreground)]/20' : ''
        }`}
      >
        <div className="p-2.5 sm:p-3">
          {toolbarAboveTextarea ? (
            <div className="mb-2 flex min-h-8 flex-wrap items-center gap-2">{toolbarAboveTextarea}</div>
          ) : null}

          {attachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--foreground)]"
                >
                  {attachment.kind === 'image' && attachment.dataUrl ? (
                    <img src={attachment.dataUrl} alt="" className="h-5 w-5 rounded object-cover" />
                  ) : isImageMime(attachment.mimeType) ? (
                    <ImageIcon size={12} strokeWidth={1.75} />
                  ) : (
                    <FileText size={12} strokeWidth={1.75} />
                  )}
                  <span className="max-w-[10rem] truncate">{attachment.name}</span>
                  {attachment.status === 'uploading' ? (
                    <Loader2 size={11} className="animate-spin text-[var(--muted)]" />
                  ) : attachment.status === 'error' ? (
                    <span className="text-[var(--chat-alert-error-text)]">!</span>
                  ) : attachment.sizeBytes ? (
                    <span className="text-[var(--muted)]">{formatSize(attachment.sizeBytes)}</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(attachment.id)}
                    className="text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (!disabled && !loading && canSend) onSubmit()
              }
            }}
            placeholder={placeholder || 'Ask anything...'}
            disabled={disabled}
            rows={2}
            className="w-full min-h-[4.75rem] max-h-40 resize-none border-0 bg-transparent px-0.5 py-2 text-sm leading-6 text-[var(--foreground)] shadow-none outline-none ring-0 placeholder:text-[var(--muted-light)] focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
          />

          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : []
              if (files.length) onAddFiles(files)
              e.target.value = ''
              setAttachMenuOpen(false)
            }}
          />
          <input
            ref={docInputRef}
            type="file"
            multiple
            accept="application/pdf,text/plain,text/markdown,.md,.txt"
            className="hidden"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : []
              if (files.length) onAddFiles(files)
              e.target.value = ''
              setAttachMenuOpen(false)
            }}
          />

          <div className="mt-2 flex min-h-9 flex-wrap items-center gap-2">
            <div ref={attachMenuRef} className="relative shrink-0">
              <button
                type="button"
                disabled={disabled || loading}
                title="Attach or generate"
                onClick={() => !disabled && !loading && setAttachMenuOpen((v) => !v)}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] ${
                  disabled || loading ? 'cursor-not-allowed opacity-50' : ''
                }`}
              >
                <Plus size={18} strokeWidth={1.75} />
              </button>
              {attachMenuOpen ? (
                <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[12.5rem] rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <ImageIcon size={14} strokeWidth={1.75} className="text-[var(--muted)]" />
                    Attach image
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
                    onClick={() => docInputRef.current?.click()}
                  >
                    <FileText size={14} strokeWidth={1.75} className="text-[var(--muted)]" />
                    Attach document
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
                    onClick={() => {
                      onGenerationModeChange('image')
                      setAttachMenuOpen(false)
                    }}
                  >
                    <Sparkles size={14} strokeWidth={1.75} className="text-[var(--muted)]" />
                    Generate image
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
                    onClick={() => {
                      onGenerationModeChange('video')
                      setAttachMenuOpen(false)
                    }}
                  >
                    <Video size={14} strokeWidth={1.75} className="text-[var(--muted)]" />
                    Generate video
                  </button>
                </div>
              ) : null}
            </div>

            {voiceEnabled ? (
              isRecording ? (
                <button
                  type="button"
                  onClick={onVoiceStop}
                  title="Stop recording"
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--chat-alert-error-bg)] px-2 text-[11px] text-[var(--chat-alert-error-text)]"
                >
                  <Square size={12} strokeWidth={1.75} />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onVoiceStart}
                  disabled={disabled || loading || transcribing}
                  title="Record voice"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  {transcribing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} strokeWidth={1.75} />}
                </button>
              )
            ) : null}

            <CollapsibleGenerationMode
              mode={generationMode}
              onChange={onGenerationModeChange}
              disabled={Boolean(loading && !canStop)}
            />

            <div className="min-w-0 flex-1" />

            {canStop && onStop ? (
              <button
                type="button"
                onClick={onStop}
                title="Stop"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] transition-colors hover:opacity-80"
              >
                <span className="h-3.5 w-3.5 rounded-sm bg-[var(--background)]" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSubmit}
                disabled={disabled || loading || !canSend}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] transition-colors hover:opacity-80 disabled:opacity-40"
              >
                {loading ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} strokeWidth={1.75} />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
