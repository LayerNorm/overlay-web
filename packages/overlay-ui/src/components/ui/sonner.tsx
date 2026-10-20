'use client'

import * as React from 'react'
import { Toaster as SonnerToaster, toast, type ToasterProps } from 'sonner'

function Toaster({ toastOptions, style, ...props }: ToasterProps) {
  return (
    <SonnerToaster
      className="toaster"
      position="bottom-right"
      closeButton
      offset={{ bottom: 'max(24px, env(safe-area-inset-bottom))', right: 'max(24px, env(safe-area-inset-right))' }}
      mobileOffset={{ bottom: 'max(16px, env(safe-area-inset-bottom))', right: 16, left: 16 }}
      style={{ zIndex: 80, ...style }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'flex w-full items-center gap-3 rounded-lg border border-(--toast-border) bg-(--toast-background) px-4 py-3 text-xs text-(--foreground) shadow-lg',
          content: 'flex min-w-0 flex-1 flex-col gap-1',
          title: 'break-words text-(--foreground)',
          description: 'text-(--muted)',
          actionButton: 'shrink-0 rounded-md bg-secondary px-2.5 py-1.5 font-medium text-secondary-foreground hover:bg-(--button-secondary-hover)',
          cancelButton: 'shrink-0 text-(--muted)',
          closeButton: 'border-(--toast-border) bg-(--toast-background) text-(--muted)',
        },
        ...toastOptions,
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
