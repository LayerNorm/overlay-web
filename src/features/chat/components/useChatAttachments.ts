'use client'

import { useRef, useState, type ClipboardEvent } from 'react'
import {
  LARGE_PASTE_MAX_BYTES,
  pastedTextFileName,
  shouldAttachPastedTextAsFile,
} from '@overlay/chat-core'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { SUPPORTED_INPUT_IMAGE_TYPES } from './chat-interface/constants'
import type { AttachedImage, PendingChatDocument } from './chat-interface/types'

const IMAGE_EXTENSION_MIME_TYPES: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

function supportedImageMimeType(file: File): string | null {
  if (SUPPORTED_INPUT_IMAGE_TYPES.has(file.type)) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSION_MIME_TYPES[ext] ?? null
}

/**
 * Attached images travel as base64 data URLs inside the message JSON body, so a
 * raw multi-MB screenshot blows straight past the platform request-size cap and
 * the send fails. Downscale to a vision-friendly edge length and re-encode as
 * WebP — a 4K screenshot lands at a few hundred KB instead of several MB.
 */
const IMAGE_ATTACHMENT_MAX_EDGE_PX = 2048
/** ~1.1 MB of image data per attachment, so even several stay under the ~4.5 MB body cap. */
export const IMAGE_ATTACHMENT_MAX_DATA_URL_CHARS = 1_500_000
/** ~3.1 MB across all attachments in one message. */
export const IMAGE_ATTACHMENTS_MAX_TOTAL_DATA_URL_CHARS = 4_200_000

export function attachedImagesTotalDataUrlChars(images: readonly { dataUrl: string }[]): number {
  return images.reduce((sum, image) => sum + image.dataUrl.length, 0)
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve(ev.target?.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(blob)
  })
}

async function prepareImageAttachment(file: File, mimeType: string): Promise<AttachedImage> {
  // Canvas encoding flattens animation — keep GIFs as-is.
  if (mimeType === 'image/gif') {
    return { dataUrl: await readBlobAsDataUrl(file), mimeType, name: file.name }
  }
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, IMAGE_ATTACHMENT_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = ctx
      ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
      : null
    // Keep original bytes when transcoding can't beat them (tiny PNGs, odd content).
    if (!blob || blob.size >= file.size) {
      return { dataUrl: await readBlobAsDataUrl(file), mimeType, name: file.name }
    }
    return { dataUrl: await readBlobAsDataUrl(blob), mimeType: 'image/webp', name: file.name }
  } catch {
    return { dataUrl: await readBlobAsDataUrl(file), mimeType, name: file.name }
  }
}

export function useChatAttachments({
  embedProjectId,
  setComposerNotice,
}: {
  embedProjectId?: string | null
  setComposerNotice: (notice: string | null) => void
}) {
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const [pendingChatDocuments, setPendingChatDocuments] = useState<PendingChatDocument[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const docInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  function removePendingDocument(clientId: string) {
    setPendingChatDocuments((prev) => prev.filter((d) => d.clientId !== clientId))
  }

  function queueDocumentUpload(file: File) {
    const clientId = crypto.randomUUID()
    setAttachmentError(null)
    setPendingChatDocuments((prev) => [
      ...prev,
      { clientId, name: file.name, fileIds: [], status: 'uploading' },
    ])
    const form = new FormData()
    form.append('file', file)
    if (embedProjectId) form.append('projectId', embedProjectId)
    void overlayAppClient.files.ingestDocumentResponse(form, {
      credentials: 'same-origin',
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string }
          setPendingChatDocuments((prev) =>
            prev.map((d) =>
              d.clientId === clientId
                ? { ...d, status: 'error' as const, error: err.error ?? 'Could not index file' }
                : d,
            ),
          )
          return
        }
        const data = (await res.json().catch(() => ({}))) as {
          ids?: string[]
          name?: string
        }
        const fileIds = Array.isArray(data.ids) ? data.ids.map((id) => String(id)) : []
        const resolvedName =
          typeof data.name === 'string' && data.name.trim().length > 0 ? data.name.trim() : file.name
        setPendingChatDocuments((prev) =>
          prev.map((d) =>
            d.clientId === clientId
              ? { ...d, status: 'ready' as const, fileIds, name: resolvedName }
              : d,
          ),
        )
      })
      .catch(() => {
        setPendingChatDocuments((prev) =>
          prev.map((d) =>
            d.clientId === clientId
              ? { ...d, status: 'error' as const, error: 'Network error' }
              : d,
          ),
        )
      })
  }

  function addDocumentsFromPicker(files: FileList | File[] | null) {
    if (!files?.length) return
    Array.from(files).forEach((file) => queueDocumentUpload(file))
  }

  function addImages(files: FileList | File[]) {
    Array.from(files).forEach((file) => {
      const mimeType = supportedImageMimeType(file)
      if (!mimeType) {
        if (!file.type.startsWith('image/')) return
        setAttachmentError(`Unsupported image format: ${file.name}. Use JPEG, PNG, GIF, or WebP.`)
        return
      }
      void prepareImageAttachment(file, mimeType).then((image) => {
        if (image.dataUrl.length > IMAGE_ATTACHMENT_MAX_DATA_URL_CHARS) {
          setAttachmentError(`"${file.name}" is too large to attach. Try a smaller or cropped image.`)
          return
        }
        setAttachedImages((prev) => {
          const totalChars = attachedImagesTotalDataUrlChars(prev) + image.dataUrl.length
          // Side-effects from updaters must be idempotent (StrictMode may re-run
          // them) — queuing the error write satisfies that.
          if (totalChars > IMAGE_ATTACHMENTS_MAX_TOTAL_DATA_URL_CHARS) {
            queueMicrotask(() =>
              setAttachmentError('Too much image data attached. Remove an image or use smaller ones.'),
            )
            return prev
          }
          queueMicrotask(() => setAttachmentError(null))
          return [...prev, image]
        })
      })
    })
  }

  function handlePaste(e: ClipboardEvent) {
    const pastedText = e.clipboardData.getData('text/plain')
    if (pastedText && shouldAttachPastedTextAsFile(pastedText)) {
      e.preventDefault()
      const blob = new Blob([pastedText], { type: 'text/plain;charset=utf-8' })
      if (blob.size > LARGE_PASTE_MAX_BYTES) {
        setAttachmentError('Pasted text is too large to attach here. Upload it as a smaller text file.')
        return
      }
      const fileName = pastedTextFileName(pastedText)
      const file = new File([blob], fileName, { type: 'text/plain' })
      queueDocumentUpload(file)
      setComposerNotice(`Large paste attached as ${fileName}.`)
      window.setTimeout(() => setComposerNotice(null), 5000)
      return
    }

    const imageFiles = Array.from(e.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f != null)
    if (imageFiles.length > 0) {
      e.preventDefault()
      addImages(imageFiles)
    }
  }

  function clearAttachments() {
    setAttachedImages([])
    setPendingChatDocuments([])
    setAttachmentError(null)
  }

  return {
    attachedImages,
    setAttachedImages,
    pendingChatDocuments,
    setPendingChatDocuments,
    attachmentError,
    setAttachmentError,
    fileInputRef,
    docInputRef,
    dragCounterRef,
    removePendingDocument,
    queueDocumentUpload,
    addDocumentsFromPicker,
    addImages,
    handlePaste,
    clearAttachments,
  }
}
