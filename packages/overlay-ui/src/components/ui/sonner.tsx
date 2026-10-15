'use client'

import * as React from 'react'
import { Toaster as SonnerToaster, toast, type ToasterProps } from 'sonner'

function Toaster({ toastOptions, style, ...props }: ToasterProps) {
  return (
    <SonnerToaster
      className="toaster"
      style={{ zIndex: 80, ...style }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'flex max-w-[min(32rem,calc(100vw-2rem))] items-center gap-3 rounded-lg border border-(--border) bg-(--surface-elevated) px-3.5 py-2 text-xs text-(--foreground) shadow-lg',
          content: 'contents',
          title: 'contents text-(--foreground)',
          description: 'text-(--muted)',
          actionButton: 'text-(--foreground)',
          cancelButton: 'text-(--muted)',
        },
        ...toastOptions,
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
