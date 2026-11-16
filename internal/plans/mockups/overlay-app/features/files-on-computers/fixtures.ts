import { HOUR, MIN, NOW, ROOMS, agentRoom, message, text, tool } from '../../fixtures/rooms'
import { VIEWER_PRINCIPAL } from '../../fixtures/agents'
import { FILES } from '../../fixtures/workspace'
import { IOS_THREAD_ID, LAUNCH_THREAD_ID, THREAD_BRANCH, writeBackMarker } from './model'

let seq = 0
function entry(partial: Record<string, unknown>) {
  seq += 1
  const name = String(partial.name)
  const extension = name.includes('.') ? name.split('.').pop() : undefined
  return {
    _id: 'k17filesrc' + String(seq).padStart(22, '0'), userId: 'user_mercedes', type: 'file', kind: 'upload', parentId: null,
    storageId: null, r2Key: null, extension, sizeBytes: 8_000 + seq * 2_100, indexable: true, indexStatus: 'indexed',
    isStorageBacked: false, scope: 'workspace', createdAt: NOW - seq * 3 * HOUR, updatedAt: NOW - seq * 2 * HOUR, ...partial,
  }
}
const folder = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  entry({ _id: id, name, type: 'folder', kind: 'folder', sizeBytes: 0, ...extra })

const WEB = 'k17foldergithubweb00000000000000'
const DRIVE = 'k17folderdrivemarketing000000000'
const MAC = 'k17foldermachomepage000000000000'
const STUDIO = 'k17foldermacstudioios00000000000'

const LAUNCH_FAQ = 'Answers to the questions customers asked most during the beta, for the December 2 launch.'

/** Folders that come from GitHub, Google Drive and the Mac, shown as ordinary folders in Files. */
function installSourceFolders() {
  const user = FILES[0]?.userId ?? 'user_mercedes'
  const rows = [
    folder(WEB, 'northwind-web'),
    folder('k17foldergithubapi00000000000000', 'northwind-api'),
    folder(DRIVE, 'Marketing'),
    folder(MAC, 'homepage-experiments', { scope: 'personal' }),
    folder(STUDIO, 'northwind-ios', { scope: 'personal' }),
    folder('k17folderwebsrc00000000000000000', 'src', { parentId: WEB }),
    entry({ name: 'README.md', parentId: WEB, mimeType: 'text/markdown', textContent: '# northwind-web\n\nThe Northwind marketing site and app shell.' }),
    entry({ name: 'package.json', parentId: WEB, mimeType: 'application/json', textContent: '{ "name": "northwind-web" }' }),
    entry({ name: 'Pricing one-pager', kind: 'note', parentId: DRIVE, previewText: 'Three plans, one price per seat, annual billing saves two months.', textContent: '# Pricing one-pager' }),
    entry({ name: 'Brand photography.zip', mimeType: 'application/zip', parentId: DRIVE, sizeBytes: 48_200_000 }),
    entry({ name: 'ShareSheet.swift', parentId: STUDIO, scope: 'personal', mimeType: 'text/plain', textContent: 'struct ShareSheet {}' }),
    entry({ name: 'NorthwindApp.xcodeproj', parentId: STUDIO, scope: 'personal', mimeType: 'application/octet-stream' }),
    entry({ name: 'hero-variants.tsx', parentId: MAC, scope: 'personal', mimeType: 'text/plain', textContent: 'export const variants = []' }),
    entry({ name: 'Launch FAQ', kind: 'note', parentId: 'k17folderlaunch00000000000000000', createdByAgent: true, previewText: LAUNCH_FAQ, textContent: `# Launch FAQ\n\n${LAUNCH_FAQ}` }),
  ].map((row) => ({ ...row, userId: user }))
  // Source folders sit first, as they would in a real workspace that connected them.
  FILES.splice(2, 0, ...rows)
}

function installLaunchThread() {
  ROOMS.push(agentRoom(LAUNCH_THREAD_ID, 'agent_atlas', 'Launch FAQ and pricing copy', 12 * MIN, 'ready', (room, atlas) => [
    message(room, VIEWER_PRINCIPAL, 58 * MIN, 'Write a launch FAQ from what’s in the Launch and Research folders, then update the pricing page copy in northwind-web to match it. Also refresh the pricing one-pager in Marketing.'),
    message(room, atlas, 41 * MIN, 'I read the beta interviews and the pricing benchmark, and wrote the FAQ into Launch. The one-pager in Marketing now uses the same plan names.', [
      tool('f1', 'computer_exec', { command: 'ls /overlay/workspace/Launch /overlay/workspace/Research', target: 'cloud' }, { success: true, exitCode: 0 }),
      tool('f2', 'computer_exec', { command: 'grep -ril "annual" /overlay/workspace/Research', target: 'cloud' }, { success: true, exitCode: 0 }),
      tool('f3', 'computer_read_file', { path: '/overlay/workspace/Research/Pricing benchmark — November.md', target: 'cloud' }, { success: true }),
      tool('f4', 'computer_write_file', { path: '/overlay/workspace/Launch/Launch FAQ.md', target: 'cloud' }, { success: true, created: true, linesAdded: 64, linesRemoved: 0 }),
      tool('f5', 'computer_write_file', { path: '/overlay/workspace/Marketing/Pricing one-pager.md', target: 'cloud' }, { success: true, created: false, linesAdded: 12, linesRemoved: 9 }),
      text('I read the beta interviews and the pricing benchmark, and wrote the FAQ into **Launch**. The one-pager in **Marketing** now uses the same plan names.'),
    ]),
    message(room, atlas, 14 * MIN, `The pricing page copy now matches the FAQ. The tests pass and pull request #491 is open from \`${THREAD_BRANCH}\`.`, [
      tool('f6', 'computer_exec', { command: 'git -C /workspace/northwind-web switch -c ' + THREAD_BRANCH, target: 'cloud' }, { success: true, exitCode: 0 }),
      tool('f7', 'computer_write_file', { path: '/workspace/northwind-web/src/app/pricing/copy.ts', target: 'cloud' }, { success: true, created: false, linesAdded: 38, linesRemoved: 19 }),
      tool('f8', 'computer_exec', { command: 'npm test -- pricing', target: 'cloud' }, { success: true, exitCode: 0 }),
      tool('f9', 'computer_exec', { command: 'gh pr create --fill --base main', target: 'cloud' }, { success: true, exitCode: 0 }),
      text(`The pricing page copy now matches the FAQ. The tests pass and pull request #491 is open from \`${THREAD_BRANCH}\`.\n\nYou edited the pricing benchmark while I was working, so I left your version alone and saved mine next to it.`),
    ]),
    writeBackMarker(room, 13 * MIN),
  ]))
}

/** A thread that runs on the Mac Studio, where Xcode and the simulators are. */
function installIosThread() {
  const studio = { target: 'mac_studio' }
  ROOMS.push(agentRoom(IOS_THREAD_ID, 'agent_atlas', 'Fix the iOS share sheet', 6 * MIN, 'working', (room, atlas) => [
    message(room, VIEWER_PRINCIPAL, 32 * MIN, 'The share sheet crashes when you share a pricing link on iOS 18. Can you fix it on the Mac Studio and run it in the simulator?'),
    message(room, atlas, 6 * MIN, 'Found it: the sheet was presented before the link preview finished loading. I moved the presentation after the preview and the crash is gone in the iPhone 16 simulator. Running the UI tests now.', [
      tool('s1', 'computer_exec', { command: 'git -C ~/dev/northwind-ios status --short', ...studio }, { success: true, exitCode: 0 }),
      tool('s2', 'computer_read_file', { path: '~/dev/northwind-ios/Northwind/Share/ShareSheet.swift', ...studio }, { success: true }),
      tool('s3', 'computer_write_file', { path: '~/dev/northwind-ios/Northwind/Share/ShareSheet.swift', ...studio }, { success: true, created: false, linesAdded: 14, linesRemoved: 6 }),
      tool('s4', 'computer_exec', { command: "xcodebuild test -scheme Northwind -destination 'platform=iOS Simulator,name=iPhone 16' -only-testing:NorthwindUITests/ShareTests", ...studio }, { success: true, exitCode: 0 }),
      text('Found it: the sheet was presented before the link preview finished loading. I moved the presentation after the preview and the crash is gone in the **iPhone 16** simulator. Running the UI tests now.'),
    ]),
  ]))
}

export function installFilesFixtures() {
  installSourceFolders()
  installLaunchThread()
  installIosThread()
}
