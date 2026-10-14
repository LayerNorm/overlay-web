'use client'

import { memo, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { Creature } from '@/components/orb/Creature'
import { clamp } from './landing-math'
import { AGENT_GROUPS, AGENT_GROUP_ORDER, type AgentGroupKey, type LandingAgent } from './landing-agents'

const WINK_MS = 700
const VIEWPORT_MARGIN = 10

/** Keep a speech bubble fully on screen: shift it sideways and re-aim its tail at the agent. */
function fitSay(agent: HTMLElement) {
  const say = agent.querySelector<HTMLElement>('.say')
  if (!say) return
  say.style.setProperty('--sx', '0px')
  const box = agent.getBoundingClientRect()
  const width = say.offsetWidth
  const left = agent.classList.contains('right') ? box.right - width : box.left
  const shift = clamp(left, VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - width) - left
  say.style.setProperty('--sx', `${shift}px`)
  say.style.setProperty('--tx', `${clamp(box.left + box.width / 2 - (left + shift), 16, width - 16)}px`)
}

function wink(event: MouseEvent<HTMLElement>) {
  const el = event.currentTarget
  el.classList.remove('wink')
  void el.offsetWidth
  el.classList.add('wink')
  window.setTimeout(() => el.classList.remove('wink'), WINK_MS)
}

function Agent({ group, index, agent }: { group: AgentGroupKey; index: number; agent: LandingAgent }) {
  const style = { '--x': agent.x, '--y': agent.y, '--s': agent.s, '--r': `${agent.r}deg`, '--d': index } as CSSProperties
  const side = `${agent.x > 50 ? ' right' : ''}${agent.y < 30 ? ' below' : ''}`
  return (
    <div
      className={`ag${side}`}
      style={style}
      data-lp="agent"
      data-g={group}
      data-i={index}
      onClick={wink}
      onPointerEnter={(e: PointerEvent<HTMLElement>) => fitSay(e.currentTarget)}
    >
      <div className="ag-in">
        <Creature shape={agent.shape} color={agent.color} size={100} label="" />
      </div>
      <div className="say">{agent.say}</div>
    </div>
  )
}

/** The creatures at the screen edges. The scroll engine moves them; this only renders them. */
export const LandingAgents = memo(function LandingAgents() {
  return (
    <div className="agents" data-lp="agents" aria-hidden="true">
      {AGENT_GROUP_ORDER.flatMap((group) =>
        AGENT_GROUPS[group].map((agent, i) => <Agent key={`${group}-${i}`} group={group} index={i} agent={agent} />),
      )}
    </div>
  )
})
