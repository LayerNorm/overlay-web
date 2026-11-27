export interface SelectionNodes<TNode> {
  anchorNode: TNode
  focusNode: TNode
}

export interface TextNodeLike {
  textContent: string | null
}

export interface TextSelectionPoint<TNode> {
  node: TNode
  offset: number
}

export function selectionNeedsReconstruction<TNode>(
  selection: SelectionNodes<TNode>,
  nodeIsIntact: (node: TNode) => boolean,
): boolean {
  return !nodeIsIntact(selection.anchorNode) || !nodeIsIntact(selection.focusNode)
}

export function textPointAtOffset<TNode extends TextNodeLike>(
  nodes: readonly TNode[],
  offset: number,
): TextSelectionPoint<TNode> | null {
  let remaining = Math.max(0, offset)
  let last: TNode | null = null

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const length = node.textContent?.length ?? 0
    if (length === 0) continue
    if (remaining < length) return { node, offset: remaining }
    if (remaining === length) {
      const next = nodes.slice(index + 1).find((candidate) => (candidate.textContent?.length ?? 0) > 0)
      return next ? { node: next, offset: 0 } : { node, offset: length }
    }
    remaining -= length
    last = node
  }

  return last ? { node: last, offset: last.textContent?.length ?? 0 } : null
}

export function textSelectionPoints<TNode extends TextNodeLike>(
  anchorNodes: readonly TNode[],
  anchorOffset: number,
  focusNodes: readonly TNode[],
  focusOffset: number,
): { anchor: TextSelectionPoint<TNode>; focus: TextSelectionPoint<TNode> } | null {
  const anchor = textPointAtOffset(anchorNodes, anchorOffset)
  const focus = textPointAtOffset(focusNodes, focusOffset)
  return anchor && focus ? { anchor, focus } : null
}
