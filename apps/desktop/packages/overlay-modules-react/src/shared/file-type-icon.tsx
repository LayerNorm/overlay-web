'use client'

import {
  Archive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileQuestion,
  FileText,
  FileVideo,
  Table2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type IconFile = {
  name: string
  extension?: string
  mimeType?: string
  kind?: string
  outputType?: string
}

type FileIconKind =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'csv'
  | 'markdown'
  | 'text'
  | 'code'
  | 'json'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'binary'

type BrandFileIconKind = 'excel' | 'pdf' | 'powerpoint' | 'word'

const BRAND_ICON_SRC: Record<BrandFileIconKind, string> = {
  excel: '/assets/file-icons/microsoft-excel.svg',
  pdf: '/assets/file-icons/pdf.svg',
  powerpoint: '/assets/file-icons/microsoft-powerpoint.svg',
  word: '/assets/file-icons/microsoft-word.svg',
}

function resolveSharedAssetPath(path: string): string {
  if (typeof document === 'undefined') return path
  const base = document.documentElement.dataset.overlayAssetBase?.replace(/\/$/, '')
  return base ? `${base}/${path.replace(/^\//, '')}` : path
}

function isBrandFileIconKind(kind: FileIconKind): kind is BrandFileIconKind {
  return kind === 'excel' || kind === 'pdf' || kind === 'powerpoint' || kind === 'word'
}

const GENERIC_ICON_META: Record<
  Exclude<FileIconKind, BrandFileIconKind>,
  { Icon: LucideIcon; bg: string; fg: string; label: string }
> = {
  archive: { Icon: Archive, bg: 'bg-stone-100 dark:bg-stone-900/45', fg: 'text-stone-600 dark:text-stone-300', label: 'Archive file' },
  audio: { Icon: FileAudio, bg: 'bg-fuchsia-100 dark:bg-fuchsia-950/45', fg: 'text-fuchsia-600 dark:text-fuchsia-300', label: 'Audio file' },
  binary: { Icon: FileQuestion, bg: 'bg-neutral-100 dark:bg-neutral-900/60', fg: 'text-neutral-500 dark:text-neutral-300', label: 'File' },
  code: { Icon: FileCode2, bg: 'bg-cyan-100 dark:bg-cyan-950/45', fg: 'text-cyan-700 dark:text-cyan-300', label: 'Code file' },
  csv: { Icon: Table2, bg: 'bg-emerald-100 dark:bg-emerald-950/45', fg: 'text-emerald-700 dark:text-emerald-300', label: 'CSV file' },
  image: { Icon: FileImage, bg: 'bg-sky-100 dark:bg-sky-950/45', fg: 'text-sky-700 dark:text-sky-300', label: 'Image file' },
  json: { Icon: FileJson, bg: 'bg-amber-100 dark:bg-amber-950/45', fg: 'text-amber-700 dark:text-amber-300', label: 'JSON file' },
  markdown: { Icon: FileText, bg: 'bg-indigo-100 dark:bg-indigo-950/45', fg: 'text-indigo-700 dark:text-indigo-300', label: 'Markdown file' },
  text: { Icon: FileText, bg: 'bg-zinc-100 dark:bg-zinc-900/60', fg: 'text-zinc-600 dark:text-zinc-300', label: 'Text file' },
  video: { Icon: FileVideo, bg: 'bg-rose-100 dark:bg-rose-950/45', fg: 'text-rose-700 dark:text-rose-300', label: 'Video file' },
}

const EXTENSION_KIND: Record<string, FileIconKind> = {
  '7z': 'archive',
  aac: 'audio',
  ai: 'image',
  avi: 'video',
  avif: 'image',
  bmp: 'image',
  bz2: 'archive',
  c: 'code',
  cc: 'code',
  cpp: 'code',
  cs: 'code',
  css: 'code',
  csv: 'csv',
  doc: 'word',
  docx: 'word',
  gif: 'image',
  go: 'code',
  gz: 'archive',
  h: 'code',
  htm: 'code',
  html: 'code',
  ico: 'image',
  java: 'code',
  jpeg: 'image',
  jpg: 'image',
  js: 'code',
  json: 'json',
  jsx: 'code',
  log: 'text',
  m4a: 'audio',
  m4v: 'video',
  markdown: 'markdown',
  md: 'markdown',
  mov: 'video',
  mp3: 'audio',
  mp4: 'video',
  mpeg: 'video',
  mpg: 'video',
  odp: 'powerpoint',
  ods: 'excel',
  odt: 'word',
  ogg: 'audio',
  ogv: 'video',
  opus: 'audio',
  pdf: 'pdf',
  php: 'code',
  png: 'image',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  py: 'code',
  rar: 'archive',
  rb: 'code',
  rs: 'code',
  sh: 'code',
  svg: 'image',
  tar: 'archive',
  toml: 'code',
  ts: 'code',
  tsx: 'code',
  txt: 'text',
  wav: 'audio',
  webm: 'video',
  webp: 'image',
  xls: 'excel',
  xlsm: 'excel',
  xlsx: 'excel',
  xml: 'code',
  yaml: 'code',
  yml: 'code',
  zip: 'archive',
}

function fileExtension(file: IconFile) {
  const fromField = file.extension?.trim().replace(/^\./, '').toLowerCase()
  if (fromField) return fromField
  const match = /\.([^.]+)$/.exec(file.name)
  return match?.[1]?.toLowerCase() ?? ''
}

export function fileIconKind(file: IconFile): FileIconKind {
  const outputType = file.outputType?.toLowerCase()
  if (outputType === 'image') return 'image'
  if (outputType === 'video') return 'video'

  const ext = fileExtension(file)
  if (ext && EXTENSION_KIND[ext]) return EXTENSION_KIND[ext]

  const mime = file.mimeType?.toLowerCase() ?? ''
  if (mime === 'application/pdf') return 'pdf'
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'excel'
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'powerpoint'
  if (mime.includes('wordprocessingml') || mime.includes('msword')) return 'word'
  if (mime === 'text/csv') return 'csv'
  if (mime === 'application/json') return 'json'
  if (mime === 'text/markdown') return 'markdown'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('text/')) return 'text'
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('archive')) return 'archive'

  return 'binary'
}

export function FileTypeIcon({
  file,
  size = 16,
  className = '',
  framed = false,
}: {
  file: IconFile
  size?: number
  className?: string
  framed?: boolean
}) {
  const kind = fileIconKind(file)
  const iconSize = Math.max(10, size)
  const frameSize = Math.max(18, Math.round(size * 1.75))

  if (isBrandFileIconKind(kind)) {
    const brandSrc = resolveSharedAssetPath(BRAND_ICON_SRC[kind])
    const img = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brandSrc}
        alt=""
        width={iconSize}
        height={iconSize}
        className={`shrink-0 object-contain ${className}`}
        aria-hidden
      />
    )
    if (!framed) return img
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-black/[0.06] dark:bg-white ${className}`}
        style={{ height: frameSize, width: frameSize }}
        aria-hidden
      >
        {img}
      </span>
    )
  }

  const meta = GENERIC_ICON_META[kind]
  const Icon = meta.Icon
  const icon = <Icon width={iconSize} height={iconSize} className={`shrink-0 ${framed ? meta.fg : className}`} aria-hidden />
  if (!framed) return icon
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg ${meta.bg} ${meta.fg} ${className}`}
      style={{ height: frameSize, width: frameSize }}
      title={meta.label}
      aria-hidden
    >
      {icon}
    </span>
  )
}
