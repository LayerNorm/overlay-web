const messageTimeFormat = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
})

export function roomMessageTime(createdAt: number): string {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? 'Invalid Date' : messageTimeFormat.format(date)
}
