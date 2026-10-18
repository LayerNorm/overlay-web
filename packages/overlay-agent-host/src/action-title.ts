/** Provider titles can contain an entire shell script. Shorten only the display label. */
export function actionTitle(title: string): string {
  if (title.length <= 2_000) return title
  let end = 1_999
  const last = title.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end--
  return title.slice(0, end) + '…'
}
