import { cn } from './utils/cn'

const BUTTON_RESET =
  'inline-block h-auto w-auto rounded-none p-0 font-normal text-inherit transition-none hover:bg-transparent hover:text-inherit disabled:cursor-auto disabled:opacity-100'

const INPUT_RESET =
  'h-auto w-auto rounded-none border-0 bg-transparent p-0 text-inherit shadow-none outline-none placeholder:text-inherit focus:ring-0 disabled:cursor-auto disabled:opacity-100'

const TEXTAREA_RESET =
  'min-h-0 w-auto resize-none rounded-none border-0 bg-transparent p-0 text-inherit leading-normal shadow-none outline-none placeholder:text-inherit focus:ring-0 disabled:cursor-auto disabled:opacity-100'

export function unstyledButton(className?: string | false | null) {
  return cn(BUTTON_RESET, className)
}

export function unstyledInput(className?: string | false | null) {
  return cn(INPUT_RESET, className)
}

export function unstyledTextarea(className?: string | false | null) {
  return cn(TEXTAREA_RESET, className)
}
