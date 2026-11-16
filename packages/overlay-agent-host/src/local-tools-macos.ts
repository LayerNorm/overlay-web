import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { LocalToolFailure } from './local-tools-errors.js'

const run = promisify(execFile)
/** Same coordinate space as the cloud driver: screenshots are at most this wide and input uses their pixels. */
export const SCREENSHOT_MAX_WIDTH = 1280
const SCREENSHOT_MAX_BYTES = 520 * 1024

/**
 * macOS desktop control through tools that ship with the OS: `screencapture`,
 * `sips` and JavaScript for Automation (CoreGraphics events). Nothing is
 * installed. The process that started the host (Overlay Desktop) must have the
 * Screen Recording and Accessibility permissions.
 */
const JXA = String.raw`
ObjC.import('CoreGraphics'); ObjC.import('ApplicationServices'); ObjC.import('AppKit')
ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []])
ObjC.bindFunction('CGRequestScreenCaptureAccess', ['bool', []])
const KEYS = {return:36, enter:36, kp_enter:76, tab:48, space:49, backspace:51, delete:117, forwarddelete:117, escape:53, esc:53,
  left:123, right:124, down:125, up:126, home:115, end:119, pageup:116, prior:116, pagedown:121, next:121, page_up:116, page_down:121,
  f1:122, f2:120, f3:99, f4:118, f5:96, f6:97, f7:98, f8:100, f9:101, f10:109, f11:103, f12:111,
  a:0, b:11, c:8, d:2, e:14, f:3, g:5, h:4, i:34, j:38, k:40, l:37, m:46, n:45, o:31, p:35, q:12, r:15, s:1, t:17, u:32, v:9, w:13, x:7, y:16, z:6,
  '0':29, '1':18, '2':19, '3':20, '4':21, '5':23, '6':22, '7':26, '8':28, '9':25,
  minus:27, '-':27, equal:24, '=':24, bracketleft:33, '[':33, bracketright:30, ']':30, backslash:42, '\\':42, semicolon:41, ';':41,
  apostrophe:39, "'":39, comma:43, ',':43, period:47, '.':47, slash:44, '/':44, grave:50, '\x60':50}
const MODS = {cmd:0x100000, command:0x100000, super:0x100000, meta:0x100000, win:0x100000, shift:0x20000, ctrl:0x40000, control:0x40000, alt:0x80000, option:0x80000, opt:0x80000}
function fail(code, message, missing) { return JSON.stringify({error: {code, message, missing: missing || []}}) }
function geometry() {
  const bounds = $.CGDisplayBounds($.CGMainDisplayID())
  const scale = $.NSScreen.mainScreen.backingScaleFactor
  const pointsWidth = bounds.size.width, pointsHeight = bounds.size.height
  const pixelWidth = Math.round(pointsWidth * scale)
  const width = Math.min(pixelWidth, ${SCREENSHOT_MAX_WIDTH})
  const height = Math.max(1, Math.round(pointsHeight * scale * width / pixelWidth))
  return {pointsWidth, pointsHeight, width, height}
}
function toPoint(g, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= g.width || y >= g.height) throw {code:'invalid_input', message:'The point is outside the screenshot.'}
  return $.CGPointMake(x * g.pointsWidth / g.width, y * g.pointsHeight / g.height)
}
function mouse(type, point, button, clicks) {
  const event = $.CGEventCreateMouseEvent(null, type, point, button)
  if (clicks) $.CGEventSetIntegerValueField(event, $.kCGMouseEventClickState, clicks)
  $.CGEventPost($.kCGHIDEventTap, event)
}
function current() { return $.CGEventGetLocation($.CGEventCreate(null)) }
const BUTTONS = {left: [1, 2, 0, 6], right: [3, 4, 1, 7], middle: [25, 26, 2, 27]}
function key(code, flags) {
  const down = $.CGEventCreateKeyboardEvent(null, code, true), up = $.CGEventCreateKeyboardEvent(null, code, false)
  $.CGEventSetFlags(down, flags); $.CGEventSetFlags(up, flags)
  $.CGEventPost($.kCGHIDEventTap, down); delay(0.01); $.CGEventPost($.kCGHIDEventTap, up)
}
function chord(text) {
  let flags = 0, code = null
  for (const part of text.split('+').map(value => value.trim().toLowerCase()).filter(Boolean)) {
    if (MODS[part] !== undefined) flags |= MODS[part]
    else if (KEYS[part] !== undefined) code = KEYS[part]
    else throw {code:'invalid_input', message:'Unknown key: ' + part}
  }
  if (code === null) throw {code:'invalid_input', message:'keys must name a key, for example cmd+c or Return.'}
  key(code, flags)
}
function typeText(text) {
  // Pasting types any Unicode text exactly; the user's plain-text clipboard is restored afterwards.
  const board = $.NSPasteboard.generalPasteboard
  const previous = board.stringForType($.NSPasteboardTypeString)
  board.clearContents
  board.setStringForType($(text), $.NSPasteboardTypeString)
  const written = board.changeCount
  key(9, 0x100000)
  delay(0.35)
  if (board.changeCount === written) {
    board.clearContents
    if (previous && !previous.isNil()) board.setStringForType(previous, $.NSPasteboardTypeString)
  }
}
function run(argv) {
  try {
    const request = JSON.parse(argv[0])
    const command = request.command
    if (command === 'permissions') return JSON.stringify({accessibility: $.AXIsProcessTrusted(), screenRecording: $.CGPreflightScreenCaptureAccess()})
    if (command === 'request_permissions') {
      const options = $.NSDictionary.dictionaryWithObjectForKey($.kCFBooleanTrue, $.kAXTrustedCheckOptionPrompt)
      return JSON.stringify({accessibility: $.AXIsProcessTrustedWithOptions(options), screenRecording: $.CGRequestScreenCaptureAccess()})
    }
    const g = geometry()
    if (command === 'geometry') return JSON.stringify(g)
    if (!$.AXIsProcessTrusted()) return fail('permission_required', 'Overlay needs the Accessibility permission on this computer to click and type. Ask the user to allow Overlay in System Settings → Privacy & Security → Accessibility.', ['accessibility'])
    if (command === 'click') {
      const point = toPoint(g, request.x, request.y)
      const button = BUTTONS[request.button || 'left']
      if (!button) throw {code:'invalid_input', message:'button must be left, middle, or right.'}
      const count = request.count === undefined ? 1 : request.count
      if (!Number.isInteger(count) || count < 1 || count > 25) throw {code:'invalid_input', message:'count must be between 1 and 25.'}
      mouse(5, point, button[2]); delay(0.03)
      for (let index = 1; index <= count; index++) { mouse(button[0], point, button[2], index); mouse(button[1], point, button[2], index); if (index < count) delay(0.08) }
    } else if (command === 'move') {
      mouse(5, toPoint(g, request.x, request.y), 0)
    } else if (command === 'drag') {
      if (!request.from || !request.to) throw {code:'invalid_input', message:'drag requires from and to points.'}
      const start = toPoint(g, request.from.x, request.from.y), end = toPoint(g, request.to.x, request.to.y)
      mouse(5, start, 0); mouse(1, start, 0, 1)
      for (let step = 1; step <= 10; step++) { mouse(6, $.CGPointMake(start.x + (end.x - start.x) * step / 10, start.y + (end.y - start.y) * step / 10), 0); delay(0.015) }
      mouse(2, end, 0, 1)
    } else if (command === 'type') {
      if (typeof request.text !== 'string' || request.text.length > 10000) throw {code:'invalid_input', message:'text must contain at most 10000 characters.'}
      typeText(request.text)
    } else if (command === 'key') {
      if (typeof request.keys !== 'string' || !request.keys.trim() || request.keys.length > 100) throw {code:'invalid_input', message:'keys must be a non-empty key sequence.'}
      for (const part of request.keys.trim().split(/\s+/)) { chord(part); delay(0.03) }
    } else if (command === 'scroll') {
      const deltas = {up: [3, 0], down: [-3, 0], left: [0, 3], right: [0, -3]}[request.direction]
      if (!deltas) throw {code:'invalid_input', message:'direction must be up, down, left, or right.'}
      if (!Number.isInteger(request.amount) || request.amount < 1 || request.amount > 25) throw {code:'invalid_input', message:'amount must be between 1 and 25.'}
      if (request.x !== undefined || request.y !== undefined) {
        const here = current()
        const x = request.x === undefined ? Math.round(here.x * g.width / g.pointsWidth) : request.x
        const y = request.y === undefined ? Math.round(here.y * g.height / g.pointsHeight) : request.y
        mouse(5, toPoint(g, x, y), 0)
      }
      for (let index = 0; index < request.amount; index++) { $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateScrollWheelEvent2(null, 1, 2, deltas[0], deltas[1], 0)); delay(0.04) }
    } else {
      throw {code:'invalid_input', message:'Unsupported desktop input command.'}
    }
    return JSON.stringify({success: true})
  } catch (error) {
    if (error && error.code) return fail(error.code, error.message)
    return fail('desktop_driver_failed', 'The desktop action failed: ' + String(error))
  }
}
`

async function jxa(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  let stdout: string
  try {
    stdout = (await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA, JSON.stringify(request)], { timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout
  } catch (error) {
    throw new LocalToolFailure('desktop_driver_failed', `The desktop action failed: ${(error as { stderr?: string }).stderr?.trim().slice(0, 300) || 'osascript did not complete'}`)
  }
  const value = JSON.parse(stdout.trim() || '{}') as Record<string, unknown>
  const error = value.error as { code?: string; message?: string; missing?: string[] } | undefined
  if (error) throw new LocalToolFailure(error.code ?? 'desktop_driver_failed', error.message ?? 'The desktop action failed.', error.missing ?? [])
  return value
}

export async function macDesktopPermissions(): Promise<{ accessibility: boolean; screenRecording: boolean }> {
  const value = await jxa({ command: 'permissions' })
  return { accessibility: value.accessibility === true, screenRecording: value.screenRecording === true }
}

/** Shows the macOS permission prompts; the user still has to switch them on in System Settings. */
export async function requestMacDesktopPermissions(): Promise<{ accessibility: boolean; screenRecording: boolean }> {
  const value = await jxa({ command: 'request_permissions' })
  return { accessibility: value.accessibility === true, screenRecording: value.screenRecording === true }
}

export async function macDesktopCapabilities(): Promise<Record<string, unknown>> {
  const [geometry, permissions] = await Promise.all([jxa({ command: 'geometry' }), macDesktopPermissions()])
  return {
    version: 'local-macos-1', display: 'main',
    screen: { width: geometry.width, height: geometry.height },
    input: permissions.accessibility, screenshot: permissions.screenRecording,
    missing: [...(permissions.accessibility ? [] : ['accessibility']), ...(permissions.screenRecording ? [] : ['screen_recording'])],
  }
}

export async function macScreenshot(): Promise<Record<string, unknown>> {
  if (!(await macDesktopPermissions()).screenRecording) {
    throw new LocalToolFailure('permission_required',
      'Overlay needs the Screen Recording permission on this computer to take screenshots. Ask the user to allow Overlay in System Settings → Privacy & Security → Screen Recording.',
      ['screen_recording'])
  }
  const directory = await mkdtemp(join(tmpdir(), 'overlay-shot-'))
  try {
    const raw = join(directory, 'raw.jpg')
    const shot = join(directory, 'shot.jpg')
    try { await run('/usr/sbin/screencapture', ['-x', '-m', '-t', 'jpg', raw], { timeout: 15_000 }) }
    catch (_error) { throw new LocalToolFailure('desktop_driver_failed', 'The screenshot could not be captured.') }
    // Keep the delivered image small enough to send: shrink quality before giving up.
    let bytes: Buffer | undefined
    for (const quality of [70, 50, 35]) {
      await run('/usr/bin/sips', ['--resampleWidth', String(SCREENSHOT_MAX_WIDTH), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), raw, '--out', shot], { timeout: 15_000 })
      bytes = await readFile(shot)
      if (bytes.length <= SCREENSHOT_MAX_BYTES) break
    }
    if (!bytes || bytes.length > SCREENSHOT_MAX_BYTES) throw new LocalToolFailure('desktop_driver_failed', 'The screenshot was too large to send.')
    const { width, height } = jpegSize(bytes)
    return { width, height, imageBase64: bytes.toString('base64'), mediaType: 'image/jpeg' }
  } finally { await rm(directory, { recursive: true, force: true }) }
}

export async function macInput(command: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return await jxa({ ...args, command })
}

/** Reads the frame size from a baseline or progressive JPEG header. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue }
    const marker = bytes[offset + 1]!
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!, width: (bytes[offset + 7]! << 8) | bytes[offset + 8]! }
    }
    offset += 2 + length
  }
  throw new LocalToolFailure('desktop_driver_failed', 'The screenshot could not be read.')
}
