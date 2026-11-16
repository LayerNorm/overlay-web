/* eslint-disable @next/next/no-img-element -- shared renderer must stay platform-neutral */
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button, Dialog, DialogContent, DialogTitle } from '@overlay/ui/primitives'
import { ArrowUpRight, ChevronRight, Download, File, FileText, PanelRight, Play } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  chatFileKind,
  fileContentUrl,
  useChatFilesHost,
  type ChatFileSummary,
} from './chat-files-context'

// Cards render inside markdown paragraphs too, so they use spans with block display rather than divs.

const cardButton = (extra: string) => unstyledButton(
  `h-auto rounded-[10px] p-0 text-left font-normal outline-hidden focus-visible:ring-2 focus-visible:ring-(--foreground) focus-visible:ring-offset-2 focus-visible:ring-offset-(--background) ${extra}`,
)

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** An image at thumbnail size (at most 320 × 240) that opens full size in a lightbox. */
export function ChatImageThumb({ src, name, fileId }: { src: string; name?: string; fileId?: string }) {
  const [open, setOpen] = useState(false)
  const label = name || 'Image'
  return (
    <>
      <Button variant="ghost" type="button" onClick={() => setOpen(true)} aria-label={`Enlarge ${label}`}
        className={cardButton('my-2 block max-w-full hover:bg-transparent')}>
        <img src={src} alt={name ?? ''} loading="lazy"
          className="block max-h-[240px] w-auto max-w-[min(100%,320px)] rounded-[10px] border border-(--border) object-cover transition-colors hover:border-(--muted-light)" />
      </Button>
      <ImageLightbox open={open} onOpenChange={setOpen} src={src} name={label} fileId={fileId} />
    </>
  )
}

function ImageLightbox({ open, onOpenChange, src, name, fileId }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  src: string
  name: string
  fileId?: string
}) {
  const { openFile } = useChatFilesHost()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[min(860px,calc(100vw-32px))]! gap-3! p-4!">
        <DialogTitle className="truncate pr-8 text-[13px] font-medium">{name}</DialogTitle>
        <img src={src} alt={name} className="max-h-[75vh] w-full rounded-lg object-contain" />
        <span className="flex gap-1.5">
          {fileId && openFile ? (
            <Button variant="ghost" size="sm" type="button" onClick={() => { onOpenChange(false); openFile({ id: fileId, name }) }}>
              <PanelRight size={14} />Show in Library
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" asChild>
            <a href={src} download={name}><Download size={14} />Download</a>
          </Button>
        </span>
      </DialogContent>
    </Dialog>
  )
}

/** A 16:9 poster frame with a play badge; opens in the host's file panel, or plays in place without one. */
export function ChatVideoCard({ src, name, fileId, caption }: { src: string; name?: string; fileId?: string; caption?: string }) {
  const { openFile } = useChatFilesHost()
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const label = name || 'Video'
  if (playing) {
    return (
      <span className="block min-w-0">
        <video src={src} controls autoPlay playsInline className="block aspect-video w-full rounded-[10px] border border-(--border) bg-black object-contain" />
        <VideoCaption name={label} caption={caption} />
      </span>
    )
  }
  const open = () => {
    if (fileId && openFile) openFile({ id: fileId, name: label, mimeType: 'video/*' })
    else setPlaying(true)
  }
  return (
    <Button variant="ghost" type="button" onClick={open} aria-label={`Play ${label}`}
      className={cardButton('group/video flex min-w-0 flex-col items-stretch gap-1.5 whitespace-normal hover:bg-transparent')}>
      <span className="relative block overflow-hidden rounded-[10px] border border-(--border) bg-black transition-colors group-hover/video:border-(--muted-light)">
        <video src={`${src}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" tabIndex={-1}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          className="pointer-events-none block aspect-video w-full object-cover" />
        <span className="absolute bottom-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-[#18181bb3] text-[#fafafa] backdrop-blur-sm">
          <Play size={11} fill="currentColor" className="ml-px" />
        </span>
        {duration !== null && Number.isFinite(duration) ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-[#18181bb3] px-1.5 text-[10px] leading-4 text-[#fafafa]">
            {formatDuration(duration)}
          </span>
        ) : null}
      </span>
      <VideoCaption name={label} caption={caption} />
    </Button>
  )
}

function VideoCaption({ name, caption }: { name: string; caption?: string }) {
  return (
    <span className="flex min-w-0 flex-col px-0.5">
      <span className="truncate text-xs leading-[18px] text-(--foreground)">{name}</span>
      {caption ? <span className="truncate text-[11px] leading-4 text-(--muted)">{caption}</span> : null}
    </span>
  )
}

type PeekLine = { kind: 'heading' | 'text'; text: string }

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The note's opening lines shaped like a page: short unpunctuated lines read as section headings, the rest as text.
 * The preview arrives as plain text, so a leading line that repeats the title is dropped.
 */
export function notePeekLines(title: string, previewText: string | undefined, limit = 5): PeekLine[] {
  const lines = (previewText ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  const titleKey = normalize(title)
  if (lines[0] && titleKey) {
    const firstKey = normalize(lines[0])
    if (firstKey && (titleKey.includes(firstKey) || firstKey.includes(titleKey))) lines.shift()
  }
  return lines.slice(0, limit).map(text => ({
    kind: text.length <= 60 && !/[.:;!?,)\]]$/.test(text) && !text.startsWith('- ') ? 'heading' : 'text',
    text: text.startsWith('- ') ? `• ${text.slice(2)}` : text,
  }))
}

function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "Created just now" for a fresh note, "Updated 5m ago" once it has been edited since. */
export function noteActivityLabel(file: Pick<ChatFileSummary, 'createdAt' | 'updatedAt'>, now = Date.now()): string | null {
  const { createdAt, updatedAt } = file
  if (!createdAt && !updatedAt) return null
  const edited = Boolean(createdAt && updatedAt && updatedAt - createdAt > 60_000)
  return edited ? `Updated ${relativeTime(updatedAt!, now)}` : `Created ${relativeTime((createdAt ?? updatedAt)!, now)}`
}

const documentCardClass = (active: boolean) => `group/doc my-1.5 block w-full max-w-[440px] overflow-hidden whitespace-normal rounded-xl border bg-(--surface-elevated) text-left transition-colors ${
  active ? 'border-[color-mix(in_srgb,var(--foreground)_40%,transparent)]' : 'border-(--border) hover:border-(--muted-light)'
}`

function DocumentCardShell({ file, active, children }: { file: ChatFileSummary; active: boolean; children: ReactNode }) {
  const { openFile } = useChatFilesHost()
  if (openFile) {
    return (
      <Button variant="ghost" type="button" aria-current={active ? 'true' : undefined}
        onClick={() => openFile({ id: file._id, name: file.name, kind: file.kind, mimeType: file.mimeType })}
        className={cardButton(`h-auto rounded-xl hover:bg-(--surface-elevated) ${documentCardClass(active)}`)}>
        {children}
      </Button>
    )
  }
  return <a href={fileContentUrl(file._id)} target="_blank" rel="noopener noreferrer" className={`${documentCardClass(active)} no-underline!`}>{children}</a>
}

function DocumentCardFooter({ file, caption }: { file: ChatFileSummary; caption: string }) {
  const Icon = chatFileKind(file) === 'note' ? FileText : File
  return (
    <span className="flex items-center gap-2.5 py-2.5 pl-3.5 pr-3">
      <Icon size={16} className="shrink-0 text-(--muted)" />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[13px] font-medium leading-[18px] text-(--foreground)">{file.name || 'Untitled'}</span>
        <span className="truncate text-xs leading-4 text-(--muted)">{caption}</span>
      </span>
      <ArrowUpRight size={16} className="shrink-0 text-(--muted-light) transition-[color,transform] group-hover/doc:-translate-y-px group-hover/doc:translate-x-px group-hover/doc:text-(--foreground)" />
    </span>
  )
}

/**
 * A note as a small page peek: its title and opening sections on a sheet, then one line saying what happened.
 * Other documents keep a single row with their type.
 */
export function ChatDocumentCard({ file }: { file: ChatFileSummary }) {
  const { activeFileId } = useChatFilesHost()
  const isNote = chatFileKind(file) === 'note'
  const active = activeFileId === file._id
  const activity = noteActivityLabel(file)
  if (!isNote) {
    return (
      <DocumentCardShell file={file} active={active}>
        <DocumentCardFooter file={file} caption={file.previewText?.trim().split('\n')[0] || 'Document'} />
      </DocumentCardShell>
    )
  }
  const lines = notePeekLines(file.name, file.previewText)
  return (
    <DocumentCardShell file={file} active={active}>
      <span aria-hidden="true" className="relative block h-32 overflow-hidden border-b border-(--border) bg-(--surface-muted) px-7 pt-4 dark:bg-[#0c0c0e]">
        <span className="block h-full overflow-hidden rounded-t-lg border border-b-0 border-(--border) bg-(--surface-elevated) px-[18px] py-3.5 transition-transform duration-200 ease-[cubic-bezier(.2,.8,.2,1)] [mask-image:linear-gradient(to_bottom,#000_55%,transparent)] group-hover/doc:-translate-y-[3px] dark:border-[#2e2e33] dark:bg-[#19191c]">
          <span className="mb-1.5 block truncate text-[13px] font-semibold leading-4 tracking-[-0.005em] text-(--foreground)">{file.name || 'Untitled'}</span>
          {lines.length ? lines.map((line, index) => line.kind === 'heading'
            ? <span key={index} className="mb-[3px] mt-[7px] block truncate text-[9.5px] font-semibold leading-3 text-(--foreground)">{line.text}</span>
            : <span key={index} className="line-clamp-2 block text-[9px] leading-[1.5] text-(--muted)">{line.text}</span>)
            : <span className="block text-[9px] text-(--muted-light)">Empty note</span>}
        </span>
      </span>
      <DocumentCardFooter file={file} caption={['Note', activity].filter(Boolean).join(' · ')} />
    </DocumentCardShell>
  )
}

/** Three or more notes and documents from one turn: one quiet list instead of a wall of cards. */
function ChatDocumentList({ files }: { files: ChatFileSummary[] }) {
  const { openFile, activeFileId } = useChatFilesHost()
  return (
    <span className="my-1.5 block w-full max-w-[440px] overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated)">
      {files.map((file, index) => {
        const Icon = chatFileKind(file) === 'note' ? FileText : File
        const activity = chatFileKind(file) === 'note' ? noteActivityLabel(file) : null
        const row = (
          <>
            <Icon size={16} className="shrink-0 text-(--muted)" />
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate text-[13px] font-medium text-(--foreground)">{file.name || 'Untitled'}</span>
              {activity ? <span className="shrink-0 text-xs text-(--muted)">{activity.split(' ')[0]}</span> : null}
            </span>
            <ChevronRight size={15} className="shrink-0 text-(--muted-light)" />
          </>
        )
        const rowClass = `flex w-full items-center gap-2.5 py-2.5 pl-3.5 pr-3 text-left transition-colors hover:bg-(--surface-subtle) ${
          index > 0 ? 'border-t border-(--border)' : ''
        } ${activeFileId === file._id ? 'bg-(--surface-subtle)' : ''}`
        return openFile ? (
          <Button key={file._id} variant="ghost" type="button"
            onClick={() => openFile({ id: file._id, name: file.name, kind: file.kind, mimeType: file.mimeType })}
            className={unstyledButton(`h-auto rounded-none font-normal ${rowClass}`)}>
            {row}
          </Button>
        ) : (
          <a key={file._id} href={fileContentUrl(file._id)} target="_blank" rel="noopener noreferrer" className={`${rowClass} no-underline!`}>{row}</a>
        )
      })}
    </span>
  )
}

/** One Overlay file as the card for its type. */
export function ChatFileCard({ file }: { file: ChatFileSummary }) {
  const kind = chatFileKind(file)
  const src = fileContentUrl(file._id)
  if (kind === 'image') return <ChatImageThumb src={src} name={file.name} fileId={file._id} />
  if (kind === 'video') return <span className="block max-w-[200px]"><ChatVideoCard src={src} name={file.name} fileId={file._id} /></span>
  return <ChatDocumentCard file={file} />
}

/**
 * Files a turn created, as compact cards: videos three across (two on narrow screens), then images, then notes and
 * documents. Ids the viewer cannot read are skipped by the host lookup.
 */
export function ChatFileCardStrip({ fileIds }: { fileIds: readonly string[] }) {
  const { useFileSummaries } = useChatFilesHost()
  const summaries = useFileSummaries(fileIds)
  if (!summaries || fileIds.length === 0) return null
  const files = fileIds.map(id => summaries.get(id)).filter((file): file is ChatFileSummary => Boolean(file))
  if (files.length === 0) return null
  const videos = files.filter(file => chatFileKind(file) === 'video')
  const images = files.filter(file => chatFileKind(file) === 'image')
  const documents = files.filter(file => chatFileKind(file) === 'note' || chatFileKind(file) === 'file')
  return (
    <div className="flex w-full flex-col gap-2 px-1 py-1" data-slot="chat-file-cards">
      {videos.length ? (
        <div className="grid w-full max-w-[600px] grid-cols-2 gap-2.5 sm:grid-cols-3">
          {videos.map(file => <ChatVideoCard key={file._id} src={fileContentUrl(file._id)} name={file.name} fileId={file._id} />)}
        </div>
      ) : null}
      {images.length ? (
        <div className="flex flex-wrap gap-2.5">
          {images.map(file => <ChatImageThumb key={file._id} src={fileContentUrl(file._id)} name={file.name} fileId={file._id} />)}
        </div>
      ) : null}
      {documents.length >= 3
        ? <ChatDocumentList files={documents} />
        : documents.map(file => <ChatDocumentCard key={file._id} file={file} />)}
    </div>
  )
}

/**
 * A Markdown image. Overlay files render as the card for their type once their metadata loads (an image while it
 * loads or without a host lookup); other URLs render as a capped thumbnail, never full width.
 */
export function ChatMarkdownImage({ src, alt, fileId }: { src: string; alt?: string; fileId: string | null }) {
  const { useFileSummaries } = useChatFilesHost()
  const summaries = useFileSummaries(fileId ? [fileId] : [])
  const file = fileId ? summaries?.get(fileId) : undefined
  if (file && chatFileKind(file) !== 'image') {
    return chatFileKind(file) === 'video'
      ? <span className="my-1 block max-w-[320px]"><ChatVideoCard src={src} name={file.name} fileId={file._id} /></span>
      : <ChatDocumentCard file={file} />
  }
  return <ChatImageThumb src={src} name={file?.name ?? alt} fileId={fileId ?? undefined} />
}
