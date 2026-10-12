import { Creature } from '@/components/orb/Creature'
import { LandingOrb } from '../LandingOrb'
import { DIcon } from './demo-icons'
import type { Msg, Persona } from './demo-types'

/** Tiny markdown: **bold**, `code`, numbered lists and paragraphs. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
        if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
        return part
      })}
    </>
  )
}

type Block = { kind: 'p'; text: string } | { kind: 'ol'; items: string[] }

function toBlocks(text: string): Block[] {
  const blocks: Block[] = []
  for (const line of text.split('\n')) {
    const item = line.match(/^\d+\.\s+(.*)/)
    const last = blocks[blocks.length - 1]
    if (item && last?.kind === 'ol') last.items.push(item[1])
    else if (item) blocks.push({ kind: 'ol', items: [item[1]] })
    else if (line.trim()) blocks.push({ kind: 'p', text: line })
  }
  return blocks
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {toBlocks(text).map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}><Inline text={b.text} /></p>
        ) : (
          <ol key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ol>
        ),
      )}
    </>
  )
}

function Body({ m }: { m: Msg }) {
  return (
    <>
      {m.tool ? <div className="tool"><LandingOrb />{m.tool}<DIcon name="down" /></div> : null}
      <Rich text={m.text} />
      {m.code ? (
        <div className="code">
          <div className="ch"><span>{m.code.label}</span><DIcon name="copy" /></div>
          <pre>{m.code.lines.join('\n')}</pre>
        </div>
      ) : null}
      {m.after ? <Rich text={m.after} /> : null}
    </>
  )
}

function Avatar({ who }: { who: Persona }) {
  return (
    <span className="cr">
      <Creature shape={who.shape} color={who.color} size={19} animated={false} />
    </span>
  )
}

export function Message({ m, who, plain }: { m: Msg; who: Persona; plain: boolean }) {
  if (m.who === 'you') {
    return <div className="msg you"><div className="bubble">{m.text}</div></div>
  }
  if (plain) {
    return <div className="msg plain"><div className="mb"><Body m={m} /></div></div>
  }
  return (
    <div className="msg">
      <Avatar who={who} />
      <div className="mb">
        <div className="by">{who.name}<small>{m.t}</small></div>
        <Body m={m} />
      </div>
    </div>
  )
}

export function TypingRow({ who, plain }: { who: Persona; plain: boolean }) {
  const dots = <div className="typing"><i /><i /><i /></div>
  if (plain) return <div className="msg plain">{dots}</div>
  return (
    <div className="msg">
      <Avatar who={who} />
      <div className="mb"><div className="by">{who.name}</div>{dots}</div>
    </div>
  )
}
