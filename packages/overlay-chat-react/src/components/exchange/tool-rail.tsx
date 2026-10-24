import { Orb } from '@overlay/ui'
import { TraceIcon } from '@overlay/ui/ai'
import React from 'react'

/** The Orb sits in every Trace step's icon slot; it breathes while the step runs. */
export function TraceOrb({ running = false }: { running?: boolean }) {
  return (
    <TraceIcon className="size-[0.5em]">
      <Orb variant="metal" size={6.5} animated={running} label="" className="size-[0.5em]! select-none [&_svg]:size-full!" />
    </TraceIcon>
  )
}

export const ToolLineLogo = TraceOrb

/** Legacy rail slot: Trace steps stack without connectors, so the connect flags are ignored. */
export function ToolLogoColumn(props: { connectTop: boolean; connectBottom: boolean; running?: boolean }) {
  return <TraceOrb running={props.running} />
}
