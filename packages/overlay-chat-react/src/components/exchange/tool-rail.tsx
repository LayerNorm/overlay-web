import { OverlayMark } from '@overlay/ui'
import { TraceIcon } from '@overlay/ui/ai'
import React from 'react'

/** The mark sits in every Trace step's icon slot; its eyes move while the step runs. */
export function TraceMark({ running = false }: { running?: boolean }) {
  return (
    <TraceIcon className="size-[1em]">
      <OverlayMark size={13} motion={running ? 'look' : 'none'} label="" className="size-[1em]! select-none [&_svg]:size-full!" />
    </TraceIcon>
  )
}

export const ToolLineLogo = TraceMark

/** Legacy rail slot: Trace steps stack without connectors, so the connect flags are ignored. */
export function ToolLogoColumn(props: { connectTop: boolean; connectBottom: boolean; running?: boolean }) {
  return <TraceMark running={props.running} />
}
