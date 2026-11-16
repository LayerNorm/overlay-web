import 'server-only'

import { folderLabel, localWorkBase, type ThreadWork } from '@/shared/agents/thread-work'
import { getOverlayServerContext } from '@/server/bootstrap'
import { directoryNames, folderLocation } from './thread-work-service'

/**
 * Tells the agent where its thread runs and where each chosen folder is (internal/develop/thread-folders.md).
 * Returns an empty string for a thread that chose neither a computer nor folders.
 */
export async function threadWorkInstructions(args: { work: ThreadWork | undefined; workspaceId: string; actorUserId: string }): Promise<string> {
  const work = args.work
  if (!work || (!work.computer && work.folders.length === 0)) return ''
  const computer = work.computer ?? { kind: 'cloud' as const }
  let computerLine = 'This thread runs on your cloud Computer. Computer tools run there unless you name another target.'
  let macBase: string | undefined
  if (computer.kind === 'mac') {
    const mac = await getOverlayServerContext().localComputerService.findForUser({
      workspaceId: args.workspaceId, userId: args.actorUserId, environmentId: computer.environmentId, includeOffline: true,
    }).catch((_error) => null)
    computerLine = mac
      ? `This thread runs on the user's own computer “${mac.name}”. Computer tools run there by default.`
      : 'This thread runs on a computer that only the person who connected it can use. If computer tools fail, tell the user to open Overlay on that computer.'
    if (mac) macBase = localWorkBase(mac.roots?.[0], mac.capability.homeDirectory)
  }
  const names = directoryNames(work.folders)
  const lines = work.folders.map((folder) => {
    const path = folderLocation(folder, computer, names, macBase)
    if (folder.source === 'overlay') {
      return `- **${folderLabel(folder)}** (Overlay Files): a copy is at \`${path}\`. Work on the files there. When this run ends, Overlay saves new, changed and deleted files back to Files on its own; notes are \`.md\` files and stay notes. Don't upload these files yourself, and don't copy them elsewhere to save them. Folders like node_modules, .git and .env files are never saved back.`
    }
    if (folder.source === 'github') {
      return `- **${folder.repository}** (GitHub): cloned at \`${path}\`. Make a new branch, commit, push it, then open a pull request. Never push to the default branch.`
    }
    return `- **${folderLabel(folder)}** (on the user's computer): \`${path}\`, edited in place.`
  })
  return ['## Where you work', computerLine, ...(lines.length ? ['Folders chosen for this thread:', ...lines] : [])].join('\n')
}
