import { cn } from './utils/cn'

const BUTTON_RESET =
  'inline-block shrink items-stretch justify-normal gap-0 h-auto w-auto rounded-none p-0 font-normal text-[length:inherit] leading-[inherit] text-inherit transition-none hover:bg-transparent hover:text-inherit disabled:cursor-auto disabled:opacity-100'

const INPUT_RESET =
  'h-auto w-auto rounded-none border-0 border-current bg-transparent p-0 text-[length:inherit] leading-[inherit] text-inherit shadow-none outline-none placeholder:text-inherit focus:ring-0 disabled:cursor-auto disabled:opacity-100'

const TEXTAREA_RESET =
  'min-h-auto w-auto resize-y rounded-none border-0 border-current bg-transparent p-0 text-[length:inherit] leading-[inherit] text-inherit shadow-none outline-none placeholder:text-inherit focus:ring-0 disabled:cursor-auto disabled:opacity-100'

export function unstyledButton(className?: string | false | null) {
  return cn(BUTTON_RESET, className)
}

export function unstyledInput(className?: string | false | null) {
  return cn(INPUT_RESET, className)
}

export function unstyledTextarea(className?: string | false | null) {
  return cn(TEXTAREA_RESET, className)
}
