import { useState } from 'react'
import { Bubble, BubbleContent, CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle, Message, MessageContent, Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle, useHighlightedCode } from '../ai'
import { Orb } from '../components/orb/Orb'

const meta = { title: 'AI Elements' }
export default meta

const SAMPLE = 'import pandas as pd\n\ndf = pd.read_csv("churn_q3.csv")\nmonthly = df.groupby("month")[["churned", "start"]].sum()\n'

function Highlighted() {
  const lines = useHighlightedCode(SAMPLE, 'python')
  return <CodeBlockContent>{lines.map((line, index) => <span key={index} className="block min-h-lh">{line}</span>)}</CodeBlockContent>
}

export function Turn() {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex max-w-2xl flex-col gap-6 p-6">
      <Message align="end"><MessageContent><Bubble variant="muted"><BubbleContent>Why did churn rise in Q3?</BubbleContent></Bubble></MessageContent></Message>
      <Message>
        <MessageContent>
          <Trace>
            <TraceCollapsible open={open} onOpenChange={setOpen}>
              <TraceCollapsibleTrigger><TraceLine><TraceIcon><Orb size={14} /></TraceIcon><TraceTitle>Worked for 14s</TraceTitle></TraceLine></TraceCollapsibleTrigger>
              <TraceCollapsibleContent>
                <Trace>
                  <TraceLine><TraceIcon><Orb size={14} /></TraceIcon><TraceTitle>Read churn_q3.csv</TraceTitle></TraceLine>
                  <TraceLine status="error"><TraceIcon><Orb size={14} /></TraceIcon><TraceTitle>Failed to fetch billing events</TraceTitle></TraceLine>
                  <TraceLine status="running"><TraceIcon><Orb size={14} /></TraceIcon><TraceTitle>Searching the web</TraceTitle></TraceLine>
                </Trace>
              </TraceCollapsibleContent>
            </TraceCollapsible>
          </Trace>
          <CodeBlock>
            <CodeBlockHeader><CodeBlockTitle>python</CodeBlockTitle><CodeBlockActions><CodeBlockCopyButton value={SAMPLE} /></CodeBlockActions></CodeBlockHeader>
            <Highlighted />
          </CodeBlock>
        </MessageContent>
      </Message>
    </div>
  )
}
