import { BrandLockup } from '@overlay/ui'

export function BrandMark({ pulse = false }: { pulse?: boolean }) {
  return (
    <div className="flex min-w-0 items-center">
      <BrandLockup motion={pulse ? 'look' : 'none'} className="text-xl text-(--foreground)" />
    </div>
  )
}
