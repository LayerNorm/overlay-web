'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { AppWindow, Check } from 'lucide-react'
import { Button, toast } from '@overlay/ui/primitives'
import { pageContextFile, type ChromePage } from '@overlay/chrome-bridge'
import { readChromePageContext, readCurrentChromePage } from '@/components/chrome/chrome-extension'

export /** In the Chrome side panel: attaches the tab next to the panel as a Markdown file (address, selection, page text). */
function ChromePageAttachItem({ onAdd, close }: { onAdd: (files: File[]) => void; close: () => void }) {
  const [page, setPage] = useState<ChromePage | null>(null)
  useEffect(() => {
    let live = true
    void readCurrentChromePage().then((current) => { if (live) setPage(current) }).catch(() => {})
    return () => { live = false }
  }, [])
  if (!page) return null
  return (
    <AttachMenuButton
      onClick={() => {
        close()
        void readChromePageContext()
          .then((context) => {
            const file = pageContextFile(context)
            onAdd([new File([file.content], file.name, { type: 'text/markdown' })])
          })
          .catch((error: unknown) => toast.error(error instanceof Error ? error.message : 'Could not read this page.'))
      }}
      icon={<AppWindow size={13} strokeWidth={1.75} />}
      label="Add this page"
      suffix={new URL(page.url).hostname.replace(/^www\./, '')}
    />
  )
}

export function AttachMenuButton({
  active,
  disabled,
  title,
  onClick,
  icon,
  label,
  suffix,
  showSwitch,
  checked,
  neutralWhenActive,
}: {
  active?: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  icon: ReactNode
  label: string
  suffix?: string
  showSwitch?: boolean
  checked?: boolean
  neutralWhenActive?: boolean
}) {
  const activeClass = active && !neutralWhenActive
    ? 'bg-(--surface-muted) text-(--foreground)'
    : 'text-(--muted) hover:bg-(--surface-muted) hover:text-(--foreground)'

  return (
    <Button variant="ghost" type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={active} className={`h-auto w-full justify-start gap-2.5 px-3 py-2 text-xs font-normal transition-colors ${disabled ? 'cursor-not-allowed text-[#bbb]' : activeClass}`}>
      {icon}
      <span>{label}</span>
      {showSwitch ? (
        <span className={`ml-auto flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${active ? 'bg-(--muted)' : 'bg-(--border)'}`}>
          <span className={`h-3 w-3 rounded-full bg-(--surface-elevated) transition-transform ${active ? 'translate-x-3' : ''}`} />
        </span>
      ) : checked ? (
        <Check size={11} strokeWidth={1.8} className="ml-auto shrink-0 text-(--foreground)" />
      ) : suffix ? (
        <span className="ml-auto max-w-27 truncate text-[10px] text-(--muted-light)">{suffix}</span>
      ) : null}
    </Button>
  )
}
