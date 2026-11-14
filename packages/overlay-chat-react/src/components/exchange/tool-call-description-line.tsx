import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'
import { toolCallDescriptionText, type ToolCallDescription } from '@overlay/chat-core'
import { useChatFilesHost } from '../files/chat-files-context'

/** Lines added and removed, as small green and red figures. */
export function DiffStats({ added, removed }: { added?: number; removed?: number }) {
  if (added === undefined && removed === undefined) return null
  return (
    <span className="inline-flex shrink-0 gap-1 text-[11px] tabular-nums">
      {added !== undefined ? <span className="text-(--success)">+{added}</span> : null}
      {removed !== undefined ? <span className="text-(--danger)">−{removed}</span> : null}
    </span>
  )
}

/**
 * One described tool call: muted verb, the file or folder in the foreground, a command in the mono font and diff
 * counts. A created Overlay file is a link that opens it where the host shows files.
 */
export function ToolCallDescriptionLine({ description }: { description: ToolCallDescription }) {
  const { openFile } = useChatFilesHost()
  const target = description.target ? (
    <span className="truncate text-(--foreground)/85">
      {description.target}
      {description.range ? <span className="text-(--muted)">{description.range}</span> : null}
    </span>
  ) : null
  return (
    <span className="flex min-w-0 items-baseline gap-1.5" aria-label={toolCallDescriptionText(description)}>
      <span className="shrink-0">{description.verb}</span>
      {target && description.fileId && openFile ? (
        <Button variant="ghost" type="button"
          onClick={() => openFile({ id: description.fileId!, name: description.target })}
          className={unstyledButton('h-auto min-w-0 truncate rounded-sm p-0 text-[13px] font-normal leading-5 hover:bg-transparent hover:underline hover:underline-offset-[3px]')}>
          {target}
        </Button>
      ) : target}
      {description.detail ? <span className="min-w-0 truncate">{description.detail}</span> : null}
      {description.code ? (
        <code className="min-w-0 truncate bg-transparent p-0 font-mono text-[12px] text-(--foreground)/85">{description.code}</code>
      ) : null}
      <DiffStats added={description.added} removed={description.removed} />
    </span>
  )
}
