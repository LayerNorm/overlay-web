export const BUG_REPORT_MAX_BYTES = 5 * 1024 * 1024
export const BUG_REPORT_MAX_FILES = 10
export const BUG_REPORT_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.log,.json,.zip,.mp4,.webm'

export type BugReportFile = { name: string; size: number; type: string }

const EXTENSIONS = /\.(png|jpe?g|webp|gif|pdf|txt|log|json|zip|mp4|webm)$/i
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'application/json', 'application/zip', 'application/x-zip-compressed', 'video/mp4', 'video/webm', 'application/octet-stream', ''])

export function validBugReportFiles(files: unknown): files is BugReportFile[] {
  return Array.isArray(files) && files.length <= BUG_REPORT_MAX_FILES && files.every((file) =>
    file && typeof file === 'object' && typeof file.name === 'string' && file.name.length <= 200 && EXTENSIONS.test(file.name) &&
    TYPES.has(file.type) && Number.isSafeInteger(file.size) && file.size > 0,
  ) && files.reduce((total, file) => total + file.size, 0) <= BUG_REPORT_MAX_BYTES
}
