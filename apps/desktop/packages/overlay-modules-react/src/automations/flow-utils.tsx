'use client'

type AutomationFlowNode = {
  id: string
  label: string
}

type AutomationFlowEdge = {
  from: string
  to: string
}

export type ParsedAutomationFlow = {
  nodes: AutomationFlowNode[]
  edges: AutomationFlowEdge[]
}

function decodeGraphLabel(value: string): string {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseFlowNode(raw: string): AutomationFlowNode | null {
  const trimmed = raw.trim()
  const quotedMatch = trimmed.match(/^([A-Za-z][\w-]*)\s*\[\s*"([^"]*)"\s*\]\s*$/)
  if (quotedMatch) {
    return { id: quotedMatch[1], label: decodeGraphLabel(quotedMatch[2]) }
  }

  const plainMatch = trimmed.match(/^([A-Za-z][\w-]*)\s*(?:\[\s*([^\]]+)\s*\])?\s*$/)
  if (!plainMatch) return null
  return { id: plainMatch[1], label: decodeGraphLabel(plainMatch[2] ?? plainMatch[1]) }
}

export function parseAutomationFlow(source: string): ParsedAutomationFlow | null {
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const graphHeader = lines.findIndex((line) => /^(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i.test(line))
  if (graphHeader < 0) return null

  const nodes = new Map<string, AutomationFlowNode>()
  const edges: AutomationFlowEdge[] = []
  const bodyLines = lines.slice(graphHeader + 1)

  for (const line of bodyLines) {
    const edgeMatch = line.match(/^([A-Za-z][\w-]*)\s*-->\s*([A-Za-z][\w-]*)\s*$/)
    if (edgeMatch) {
      const [, from, to] = edgeMatch
      edges.push({ from, to })
      if (!nodes.has(from)) nodes.set(from, { id: from, label: from })
      if (!nodes.has(to)) nodes.set(to, { id: to, label: to })
      continue
    }

    const node = parseFlowNode(line)
    if (node) {
      nodes.set(node.id, node)
    }
  }

  if (nodes.size === 0) return null
  return { nodes: [...nodes.values()].slice(0, 12), edges }
}

function wrapGraphLabel(label: string): string[] {
  const words = label.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > 48 && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
    if (lines.length === 2) break
  }

  if (current && lines.length < 2) lines.push(current)
  const consumed = lines.join(' ').length
  if (consumed < label.length && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:]?$/, '')}...`
  }
  return lines.length > 0 ? lines : [label]
}

export function AutomationFlowPreview({ flow }: { flow: ParsedAutomationFlow }) {
  const nodeWidth = 540
  const nodeHeight = 64
  const gap = 46
  const paddingX = 60
  const paddingY = 34
  const width = nodeWidth + paddingX * 2
  const height = paddingY * 2 + flow.nodes.length * nodeHeight + Math.max(0, flow.nodes.length - 1) * gap
  const nodeIndex = new Map(flow.nodes.map((node, index) => [node.id, index]))

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Automation flowchart preview"
      className="h-auto min-w-[34rem] max-w-full text-[var(--foreground)]"
    >
      <defs>
        <marker
          id="automation-flow-arrow"
          markerWidth="10"
          markerHeight="10"
          refX="7"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L8,3 z" fill="currentColor" opacity="0.55" />
        </marker>
      </defs>
      {flow.edges.map((edge, index) => {
        const fromIndex = nodeIndex.get(edge.from)
        const toIndex = nodeIndex.get(edge.to)
        if (fromIndex === undefined || toIndex === undefined) return null
        const x = paddingX + nodeWidth / 2
        const y1 = paddingY + fromIndex * (nodeHeight + gap) + nodeHeight
        const y2 = paddingY + toIndex * (nodeHeight + gap)
        return (
          <line
            key={`${edge.from}-${edge.to}-${index}`}
            x1={x}
            y1={y1 + 8}
            x2={x}
            y2={y2 - 8}
            stroke="currentColor"
            strokeWidth="2"
            strokeOpacity="0.35"
            markerEnd="url(#automation-flow-arrow)"
          />
        )
      })}
      {flow.nodes.map((node, index) => {
        const x = paddingX
        const y = paddingY + index * (nodeHeight + gap)
        const labelLines = wrapGraphLabel(node.label)
        return (
          <g key={node.id}>
            <rect
              x={x}
              y={y}
              width={nodeWidth}
              height={nodeHeight}
              rx="14"
              fill="var(--surface-elevated)"
              stroke="var(--border)"
            />
            <circle
              cx={x + 28}
              cy={y + nodeHeight / 2}
              r="12"
              fill="var(--surface-subtle)"
              stroke="var(--border)"
            />
            <text
              x={x + 28}
              y={y + nodeHeight / 2 + 4}
              textAnchor="middle"
              className="fill-current text-[10px] font-semibold"
            >
              {index + 1}
            </text>
            <text
              x={x + 54}
              y={y + 27}
              className="fill-current text-[13px] font-medium"
            >
              {labelLines.map((line, lineIndex) => (
                <tspan key={lineIndex} x={x + 54} dy={lineIndex === 0 ? 0 : 17}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
