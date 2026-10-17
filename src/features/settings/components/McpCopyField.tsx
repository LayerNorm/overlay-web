'use client'

import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** A read-only value (an address, a command) with a copy button. */
export function McpCopyField({ value, label, multiline = false }: { value: string; label: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    }).catch(() => undefined)
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-(--border) bg-(--surface-subtle) px-3 py-2">
      {multiline
        ? <pre aria-label={label} className="min-w-0 flex-1 overflow-x-auto whitespace-pre text-xs text-(--foreground)">{value}</pre>
        : <code aria-label={label} className="min-w-0 flex-1 truncate text-xs leading-5 text-(--foreground)">{value}</code>}
      <Button variant="ghost"
        type="button"
        aria-label={`Copy ${label}`}
        onClick={copy}
        className={unstyledButton(`mt-0.5 shrink-0 text-(--muted) transition-colors hover:text-(--foreground)`)}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
    </div>
  )
}
