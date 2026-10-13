'use client'
export default function WorkError({ reset }: { reset: () => void }) {
  return <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6"><p className="text-sm">Work couldn’t load.</p><button onClick={reset} className="rounded-md border border-(--border) bg-(--surface-subtle) px-3 py-2 text-sm">Try again</button></div>
}
