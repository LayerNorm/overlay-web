'use client'

import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@overlay/ui/primitives'
import { WORKSPACE_ICON_PRESETS } from '@/shared/workspaces/icon-presets'

export type IdentityImageChoice = { file: File } | { preset: string | null } | { reset: true }

export function IdentityImageEditor({ open, onOpenChange, ...props }: {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  photoUrl?: string | null
  fallback: string
  workspace?: boolean
  resetLabel: string
  onSave(choice: IdentityImageChoice): Promise<void>
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    {open ? <ImageEditorContent {...props} onClose={() => onOpenChange(false)} /> : null}
  </Dialog>
}

function ImageEditorContent({ title, photoUrl, fallback, workspace, resetLabel, onSave, onClose }: {
  title: string; photoUrl?: string | null; fallback: string; workspace?: boolean; resetLabel: string
  onSave(choice: IdentityImageChoice): Promise<void>; onClose(): void
}) {
  const input = useRef<HTMLInputElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const bitmap = useRef<ImageBitmap | null>(null)
  const mounted = useRef(true)
  const [source, setSource] = useState<ImageBitmap | null>(null)
  const [choice, setChoice] = useState<IdentityImageChoice | null>(null)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 50, y: 50 })
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; bitmap.current?.close() }
  }, [])
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context || !source) return
    const side = Math.min(source.width, source.height) / zoom
    context.clearRect(0, 0, 512, 512)
    context.drawImage(source, (source.width - side) * position.x / 100, (source.height - side) * position.y / 100, side, side, 0, 0, 512, 512)
  }, [source, zoom, position])

  async function read(file?: File) {
    if (!file) return
    setError(null)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP image up to 5 MB.')
      return
    }
    setReading(true)
    try {
      const image = await createImageBitmap(file)
      if (!mounted.current) { image.close(); return }
      if (image.width * image.height > 40_000_000) { image.close(); throw new Error('Choose an image under 40 megapixels.') }
      bitmap.current?.close()
      bitmap.current = image
      setSource(image)
      setChoice(null)
      setZoom(1)
      setPosition({ x: 50, y: 50 })
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : 'Could not read this image.')
    } finally {
      if (mounted.current) setReading(false)
    }
  }

  function choose(next: IdentityImageChoice) {
    setSource(null)
    setChoice(next)
    setError(null)
  }

  async function save() {
    if (busy || reading) return
    setBusy(true)
    setError(null)
    try {
      let next = choice
      if (source && canvas.current) {
        const blob = await new Promise<Blob>((resolve, reject) => canvas.current!.toBlob((value) => value ? resolve(value) : reject(new Error('Could not crop this image.')), 'image/webp', 0.9))
        next = { file: new File([blob], 'avatar.webp', { type: 'image/webp' }) }
      }
      if (next) await onSave(next)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this image.')
    } finally { setBusy(false) }
  }

  const preview = choice && 'preset' in choice ? WORKSPACE_ICON_PRESETS.find((item) => item.id === choice.preset)?.url
    : choice && 'reset' in choice ? undefined : photoUrl ?? undefined
  return <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[420px]" showCloseButton={!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onInteractOutside={(event) => { if (busy) event.preventDefault() }}>
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{workspace ? 'Shown wherever this workspace appears.' : 'Choose how people see you.'}</DialogDescription></DialogHeader>
    <div className="flex justify-center py-3">
      {source ? <canvas ref={canvas} width={512} height={512} className={`size-44 ${workspace ? 'rounded-xl' : 'rounded-full'}`} aria-label="Cropped image preview" />
        : <Avatar className={`size-22 ${workspace ? 'rounded-xl' : ''}`}><AvatarImage src={preview} alt="" /><AvatarFallback>{fallback}</AvatarFallback></Avatar>}
    </div>
    {source ? <div className="space-y-3">
      <Label htmlFor="avatar-zoom">Zoom</Label><Input id="avatar-zoom" type="range" min="1" max="3" step="0.05" value={zoom} disabled={busy} onChange={(event) => setZoom(Number(event.target.value))} />
      <Label htmlFor="avatar-x">Horizontal position</Label><Input id="avatar-x" type="range" min="0" max="100" value={position.x} disabled={busy} onChange={(event) => setPosition({ ...position, x: Number(event.target.value) })} />
      <Label htmlFor="avatar-y">Vertical position</Label><Input id="avatar-y" type="range" min="0" max="100" value={position.y} disabled={busy} onChange={(event) => setPosition({ ...position, y: Number(event.target.value) })} />
    </div> : null}
    {workspace ? <div className="space-y-3"><p className="text-sm font-medium">Choose a preset</p><div className="grid grid-cols-6 gap-2">
      {WORKSPACE_ICON_PRESETS.map((preset, index) => <Button key={preset.id} variant="ghost" className="h-auto rounded-lg p-1 aria-pressed:ring-2 aria-pressed:ring-ring" aria-label={`Select workspace preset ${index + 1}`} aria-pressed={Boolean(choice && 'preset' in choice && choice.preset === preset.id)} disabled={busy || reading} onClick={() => choose({ preset: preset.id })}><Avatar className="size-10 rounded-md"><AvatarImage src={preset.url} alt="" /></Avatar></Button>)}
    </div></div> : null}
    <Input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Upload image" disabled={busy || reading} onChange={(event) => { void read(event.target.files?.[0]); event.target.value = '' }} />
    <Button variant="secondary" disabled={busy || reading} onClick={() => input.current?.click()}><Upload className="size-4" />{reading ? 'Reading image...' : 'Upload image'}</Button>
    <p className="text-xs text-muted-foreground">JPG, PNG or WebP. Up to 5 MB.</p>
    <Button variant="ghost" className="justify-start" disabled={busy || reading} onClick={() => choose(workspace ? { preset: null } : { reset: true })}>{resetLabel}</Button>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <DialogFooter><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="secondary" disabled={busy || reading || (!source && !choice)} onClick={() => void save()}>{busy ? 'Saving...' : 'Save'}</Button></DialogFooter>
  </DialogContent>
}
