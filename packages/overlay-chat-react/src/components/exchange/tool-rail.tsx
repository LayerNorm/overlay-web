import { OverlayMark } from '@overlay/ui'
import { TraceIcon } from '@overlay/ui/ai'
import React from 'react'

/** The mark sits in every Trace step's icon slot; its eyes move while the step runs. */
export function TraceOrb({ running = false }: { running?: boolean }) {
  return (
    <TraceIcon className="size-[0.5em]">
      <OverlayMark size={6.5} motion={running ? 'look' : 'none'} label="" className="size-[0.5em]! select-none [&_svg]:size-full!" />
    </TraceIcon>
  )
}

export const ToolLineLogo = TraceOrb

/** Legacy rail slot: Trace steps stack without connectors, so the connect flags are ignored. */
export function ToolLogoColumn(props: { connectTop: boolean; connectBottom: boolean; running?: boolean }) {
  return <TraceOrb running={props.running} />
}
