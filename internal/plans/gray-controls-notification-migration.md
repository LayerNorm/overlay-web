# Gray controls and notification migration

## Migrated

- Shared controls use the approved gray palette. Work row icons and shared page headers align to the approved mockup.
- Work, chat, scope/archive, memory, upload, note-conflict, agent, account, provider, computer, workspace and Slack import action outcomes use bottom-right Sonner notifications.
- Upload loading notifications settle under the same per-operation id. Archive Undo and bulk partial-failure summaries remain available.
- Slack OAuth feedback is consumed once. File and folder moves in Knowledge report their explicit outcomes.

## Intentionally retained

- Initial-load failures keep their retry or recovery UI, including Work, Knowledge files, agent surfaces and computer loading.
- Field validation remains inline, including project roots and account deletion confirmation.
- Machine setup failures, cloud machine status, import job history/progress/failures, chat budget/load/run recovery, and note conflict recovery remain durable.
- Attachment chips and validation, file-list loading/retry, ordinary autosave and historical state do not generate action toasts.
- Archive Undo remains attached to the archive notification and is not duplicated by a success toast.

The audited code has folder/file move actions but no separate memory-move operation. Those Knowledge file moves now report their outcome.
