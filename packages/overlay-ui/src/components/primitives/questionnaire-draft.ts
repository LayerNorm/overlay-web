export type QuestionnaireSuggestion = { id: string; label: string }

const separator = ' · '

export function selectedQuestionnaireChoices(value: string, choices: readonly QuestionnaireSuggestion[]): string[] {
  const parts = value.split(separator).map((part) => part.trim())
  return choices.filter((choice) => parts.includes(choice.label)).map((choice) => choice.id)
}

export function toggleQuestionnaireChoice(value: string, choices: readonly QuestionnaireSuggestion[], id: string, multiple: boolean): string {
  const choice = choices.find((candidate) => candidate.id === id)
  if (!choice) return value
  const parts = value ? value.split(separator) : []
  const selected = selectedQuestionnaireChoices(value, choices)
  if (selected.includes(id)) return parts.filter((part) => part.trim() !== choice.label).join(separator)
  const retained = multiple ? parts : parts.filter((part) => !choices.some((candidate) => candidate.label === part.trim()))
  return [...retained, choice.label].filter((part) => part.trim()).join(separator)
}
