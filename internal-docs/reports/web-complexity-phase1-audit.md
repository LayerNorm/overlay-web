# Web Complexity Phase 1 Audit

Generated during Phase 1 mitigation.

## Removed

These `src/features/landing/components/*` files were static zero-fan-in and only referenced each other:

- `AgentsPipeline.tsx`
- `AllInOnePlace.tsx`
- `AudienceShowcase.tsx`
- `ClosingCTA.tsx`
- `ContextHub.tsx`
- `CreationBento.tsx`
- `ExtensionsStrip.tsx`
- `HeroSection.tsx`
- `ModelsShowcase.tsx`
- `OverlayDemo.tsx`
- `ProductCanvases.tsx`
- `VoiceDemo.tsx`

The active marketing routes now use `src/features/marketing/*` and `src/features/landing/lib/*`.

## Kept

- `packages/overlay-ui/**`: public package surface. Some files have low app-local fan-in because they are exported through package barrels and consumed through `@overlay/ui`, `@overlay/ui/feedback`, `@overlay/ui/overlays`, or `@overlay/ui/chat`.
- `src/features/knowledge/components/KnowledgeView.tsx`: loaded dynamically by active app routes.
- `src/features/knowledge/components/MemoriesView.tsx`: referenced by the settings route.
- `src/features/notebook/components/NotebookEditor.tsx`: loaded dynamically by the notes route and used by projects.
- `src/features/notebook/components/AutomationInstructionsEditor.tsx`: used by the chat automation editor.
- `src/features/projects/components/ProjectsView.tsx`: loaded dynamically by the projects route.
- `src/features/integrations/components/IntegrationsView.tsx`: used by integrations/tools routes.
- `src/features/integrations/components/McpServersView.tsx`: used by tools.
- `src/features/automations/components/SkillsView.tsx`: used by tools.

## Deferred

No additional zero-fan-in package or feature wrapper was deleted in this pass. The remaining candidates need package API review, dynamic import review, or route-level behavior checks before removal.
