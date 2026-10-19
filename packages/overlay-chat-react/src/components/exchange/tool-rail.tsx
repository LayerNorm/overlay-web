import { Orb } from '@overlay/ui'
import { TraceIcon } from '@overlay/ui/ai'
import React from 'react'

/** The Orb sits in every Trace step's icon slot; it breathes while the step runs. */
export function TraceOrb({ running = false }: { running?: boolean }) {
  return (
    <TraceIcon>
      <Orb variant="metal" size={14} animated={running} label="" className="select-none" />
    </TraceIcon>
  )
}

export const ToolLineLogo = TraceOrb

/** Legacy rail slot: Trace steps stack without connectors, so the connect flags are ignored. */
export function ToolLogoColumn(props: { connectTop: boolean; connectBottom: boolean; running?: boolean }) {
  return <TraceOrb running={props.running} />
}
