/* eslint-disable @next/next/no-img-element -- shared renderer must stay platform-neutral */
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button, Dialog, DialogContent, DialogTitle } from '@overlay/ui/primitives'
import { Download, File, FileText, PanelRight, Play } from 'lucide-react'
import { useState } from 'react'
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
        className={cardButton('my-1 block max-w-full hover:bg-transparent')}>
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

/** A note or document: icon, title and a two-line preview. */
export function ChatDocumentCard({ file }: { file: ChatFileSummary }) {
  const { openFile } = useChatFilesHost()
  const isNote = chatFileKind(file) === 'note'
  const Icon = isNote ? FileText : File
  const body = (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--surface-subtle) text-(--muted)">
        <Icon size={15} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium leading-[19px] text-(--foreground)">{file.name}</span>
        <span className="line-clamp-2 text-xs leading-[18px] text-(--muted)">
          {file.previewText?.trim() || (isNote ? 'Note' : 'Document')}
        </span>
      </span>
    </>
  )
  const className = 'my-1 flex w-full max-w-[460px] items-start gap-3 whitespace-normal rounded-xl border border-(--border) px-3.5 py-3 transition-colors hover:border-(--muted-light) hover:bg-transparent'
  if (openFile) {
    return (
      <Button variant="ghost" type="button" onClick={() => openFile({ id: file._id, name: file.name, kind: file.kind, mimeType: file.mimeType })}
        className={unstyledButton(`h-auto text-left font-normal ${className}`)}>
        {body}
      </Button>
    )
  }
  return <a href={fileContentUrl(file._id)} target="_blank" rel="noopener noreferrer" className={`${className} no-underline!`}>{body}</a>
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
      {documents.map(file => <ChatDocumentCard key={file._id} file={file} />)}
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
