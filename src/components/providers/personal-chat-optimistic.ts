export interface PersonalChatRow {
  _id: string
}

export function updatePersonalChatRow<Row extends PersonalChatRow>(
  rows: readonly Row[],
  conversationId: string,
  update: (row: Row) => Row,
): Row[] {
  return rows.map((row) => (row._id === conversationId ? update(row) : row))
}

export function removePersonalChatRow<Row extends PersonalChatRow>(
  rows: readonly Row[],
  conversationId: string,
): Row[] {
  return rows.filter((row) => row._id !== conversationId)
}

export function insertPersonalChatRow<Row extends PersonalChatRow>(
  rows: readonly Row[],
  row: Row,
): Row[] {
  return [row, ...rows.filter((existing) => existing._id !== row._id)]
}
