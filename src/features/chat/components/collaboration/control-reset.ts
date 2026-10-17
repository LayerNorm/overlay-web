import { cn } from '@overlay/ui'

const BUTTON_RESET =
  'inline-block h-auto w-auto rounded-none p-0 font-normal text-inherit transition-none hover:bg-transparent hover:text-inherit disabled:cursor-auto disabled:opacity-100'

export function unstyledButton(className?: string | false | null) {
  return cn(BUTTON_RESET, className)
}
