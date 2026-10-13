import type { HTMLAttributes, ReactNode } from 'react'
import { useDialogReturnFocus } from '../../hooks/useDialogReturnFocus'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

export interface DialogFrameProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean
  title?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  actions?: ReactNode
  onOpenChange?: (open: boolean) => void
}

export function DialogFrame({
  open,
  title,
  description,
  footer,
  actions,
  onOpenChange,
  children,
  className,
  ...props
}: DialogFrameProps) {
  const returnFocus = useDialogReturnFocus()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={className} {...returnFocus} {...props}>
        {title || actions ? (
          <DialogHeader>
            {title ? <DialogTitle>{title}</DialogTitle> : <span />}
            {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
          </DialogHeader>
        ) : null}
        {description ? <DialogDescription className="mt-1.5">{description}</DialogDescription> : null}
        {children}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  )
}

