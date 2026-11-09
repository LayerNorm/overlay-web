'use client'

import { useEffect, useId, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import { CircleHelp, FilePlus2, Loader2, Trash2 } from 'lucide-react'
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Input, Label, Popover, PopoverContent, PopoverTrigger, SidebarMenuButton,
  SidebarMenuItem, Textarea,
} from '@overlay/ui/primitives'
import { BUG_REPORT_ACCEPT, validBugReportFiles } from '@/shared/storage/bug-report'

export function HelpMenu({ collapsed, docsUrl }: { collapsed: boolean; docsUrl: string }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ url: string; emailSent: boolean } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const preparedUpload = useRef<{ files: File[]; ticket: string; expiresAt: number } | null>(null)
  const submission = useRef<{ payload: string; key: string } | null>(null)
  const descriptionId = useId()
  const attachmentsId = useId()
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  function changeMenu(open: boolean) {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setMenuOpen(open)
  }

  function openMenu(event: PointerEvent) {
    if (event.pointerType === 'mouse') changeMenu(true)
  }

  function scheduleClose(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setMenuOpen(false), 180)
  }

  function addFiles(incoming: FileList | File[]) {
    const additions = Array.from(incoming)
    if (!validBugReportFiles([...files, ...additions])) {
      setError('Attach up to 10 supported files, 5 MB in total (images, PDF, text, JSON, ZIP, or video).')
      return
    }
    setFiles((current) => [...current, ...additions])
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !description.trim()) return
    setError('')
    setBusy(true)
    try {
      let ticket: string | undefined
      if (files.length) {
        if (preparedUpload.current?.files === files && preparedUpload.current.expiresAt > Date.now()) {
          ticket = preparedUpload.current.ticket
        } else {
          const uploadResponse = await fetch('/api/bug-report/upload', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: files.map(({ name, size, type }) => ({ name, size, type })) }),
          })
          const upload = await uploadResponse.json() as { ticket?: string; urls?: string[]; error?: string }
          if (!uploadResponse.ok || !upload.ticket || upload.urls?.length !== files.length) throw new Error(upload.error || 'Could not prepare attachments.')
          for (const [index, file] of files.entries()) {
            const response = await fetch(upload.urls[index], { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', 'If-None-Match': '*' }, body: file })
            if (!response.ok) throw new Error('Could not upload an attachment. Please try again.')
          }
          ticket = upload.ticket
          preparedUpload.current = { files, ticket, expiresAt: Date.now() + 9 * 60_000 }
        }
      }
      const body = JSON.stringify({ description: description.trim(), ticket })
      if (submission.current?.payload !== body) submission.current = { payload: body, key: crypto.randomUUID() }
      const response = await fetch('/api/bug-report', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submission.current.key }, body })
      const payload = await response.json() as { error?: string; url?: string; emailSent?: boolean }
      if (!response.ok || !payload.url) throw new Error(payload.error || 'Could not submit the bug report.')
      setResult({ url: payload.url, emailSent: payload.emailSent === true })
      setDescription('')
      setFiles([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit the bug report.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <SidebarMenuItem onPointerEnter={openMenu} onPointerLeave={scheduleClose}>
      <Popover open={menuOpen} onOpenChange={changeMenu}>
        <PopoverTrigger asChild>
          <SidebarMenuButton aria-label="Help" aria-expanded={menuOpen} title={collapsed ? 'Help' : undefined}>
            <CircleHelp size={18} aria-hidden />{collapsed ? null : <span>Help</span>}
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-44 p-1" onPointerEnter={openMenu} onPointerLeave={scheduleClose}>
          <Button variant="ghost" asChild className="w-full justify-start text-sm">
            <a href={docsUrl} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>Docs</a>
          </Button>
          <Button type="button" variant="ghost" className="w-full justify-start text-sm" onClick={() => { setMenuOpen(false); setResult(null); setError(''); setDialogOpen(true) }}>
            Submit a bug
          </Button>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!busy) setDialogOpen(open) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[480px]" onInteractOutside={(event) => { if (busy) event.preventDefault() }}>
        <DialogHeader className="flex-col items-start gap-2 pr-6">
          <DialogTitle className="whitespace-normal">Submit a bug</DialogTitle>
          <DialogDescription>Describe what happened. Reports and attachments are visible in the public GitHub repository.</DialogDescription>
        </DialogHeader>
        {result ? <div className="space-y-3 text-sm">
          <p>Bug report submitted. <a href={result.url} target="_blank" rel="noopener noreferrer" className="underline">View issue</a></p>
          {!result.emailSent ? <p className="text-(--muted)">The email notification could not be sent. Your issue was created.</p> : null}
          <Button type="button" onClick={() => setDialogOpen(false)}>Done</Button>
        </div> : <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={descriptionId}>What happened?</Label>
            <Textarea id={descriptionId} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} required rows={6} placeholder="Tell us what happened and how to reproduce it." disabled={busy} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={attachmentsId}>Attachments (5 MB total)</Label>
            <Input ref={fileInput} id={attachmentsId} type="file" multiple accept={BUG_REPORT_ACCEPT} className="hidden" disabled={busy} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = '' }} />
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}><FilePlus2 size={16} aria-hidden /> Add files</Button>
            <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) addFiles(event.dataTransfer.files) }} className="rounded-md border border-dashed p-3 text-xs text-(--muted)" aria-label="Drop bug report attachments here">Drop files here, or choose files above.</div>
            {files.length ? <ul className="space-y-1">{files.map((file, index) => <li key={`${index}-${file.name}`} className="flex items-center justify-between gap-2 text-xs"><span className="truncate">{file.name}</span><Button type="button" variant="ghost" size="icon" aria-label={`Remove ${file.name}`} className="size-7" disabled={busy} onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}><Trash2 size={14} aria-hidden /></Button></li>)}</ul> : null}
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !description.trim()}>{busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}Submit bug</Button>
          </DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </>
}
