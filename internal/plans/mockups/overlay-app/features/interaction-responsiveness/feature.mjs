import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))

const feature = {
  out: 'interaction-responsiveness.html',
  title: 'Overlay | Interaction responsiveness mockup',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { InteractionScenarioProvider } from ${components}\n`,
      replace: [
        [
          '<AppClientProviders initialUser={MOCK_USER}>\n      <DesktopProvider>',
          '<AppClientProviders initialUser={MOCK_USER}>\n      <InteractionScenarioProvider>\n      <DesktopProvider>',
        ],
        [
          '</WorkspaceAppBoundary></DesktopProvider>\n    </AppClientProviders>,',
          '</WorkspaceAppBoundary></DesktopProvider>\n      </InteractionScenarioProvider>\n    </AppClientProviders>,',
        ],
      ],
    },
    {
      file: 'src/features/work/components/WorkRow.tsx',
      imports: `import { AssignmentStatus, useProjectedAssignee } from ${components}\n`,
      replace: [
        [
          'const assignee = item.assigneePrincipalId ? personByPrincipal.get(item.assigneePrincipalId) ?? null : null',
          'const storedAssignee = item.assigneePrincipalId ? personByPrincipal.get(item.assigneePrincipalId) ?? null : null\n  const assignee = useProjectedAssignee(item, storedAssignee, people)',
        ],
        [
          '        </OwnerPicker>\n      </div>',
          '        </OwnerPicker>\n        <AssignmentStatus itemTitle={item.title} compact />\n      </div>',
        ],
      ],
    },
    {
      file: 'src/features/work/components/WorkPeek.tsx',
      imports: `import { AssignmentStatus, useProjectedAssignee } from ${components}\n`,
      replace: [
        [
          'function PropertyRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {',
          'function PropertyRow({ icon, label, children, wrap = false }: { icon: ReactNode; label: string; children: ReactNode; wrap?: boolean }) {',
        ],
        [
          '<div className="flex h-[30px] min-w-0 items-center text-(--foreground) [&>button]:-ml-2">{children}</div>',
          '<div className={`flex ${wrap ? "h-auto flex-wrap gap-y-1" : "h-[30px]"} min-w-0 items-center text-(--foreground) [&>button]:-ml-2`}>{children}</div>',
        ],
        [
          '<PropertyRow icon={<User size={13} />} label="Owner">',
          '<PropertyRow icon={<User size={13} />} label="Owner" wrap>',
        ],
        [
          'const assignee: WorkPerson | null = item.assigneePrincipalId ? personByPrincipal.get(item.assigneePrincipalId) ?? null : null',
          'const storedAssignee: WorkPerson | null = item.assigneePrincipalId ? personByPrincipal.get(item.assigneePrincipalId) ?? null : null\n  const assignee = useProjectedAssignee(item, storedAssignee, people)',
        ],
        [
          '        </OwnerPicker>\n      </PropertyRow>\n      <LinkedThreadRow item={item} assignee={assignee} />',
          '        </OwnerPicker>\n        <AssignmentStatus itemTitle={item.title} />\n      </PropertyRow>\n      <LinkedThreadRow item={item} assignee={assignee} />',
        ],
      ],
    },
    {
      file: 'src/features/agents/components/AgentEditorPage.parts.tsx',
      imports: `import { AgentLifecyclePanel } from ${components}\n`,
      replace: [[
        '          <OverlayAgentPermissionsField\n',
        '          {mode === \'new\' ? <AgentLifecyclePanel name={name} computerEnabled={computersAvailable && Array.from(enabledToolGroups).includes(\'computer\')} /> : null}\n\n          <OverlayAgentPermissionsField\n',
      ]],
    },
    {
      file: 'src/features/agents/components/NewAgentDialog.tsx',
      imports: `import { AgentLifecyclePanel } from ${components}\n`,
      replace: [[
        '<NewAgentFields\n          draft={draft}\n          onChange={update}\n          modelField={modelField}\n          computersAvailable={computersAvailable}\n        />',
        '<NewAgentFields\n          draft={draft}\n          onChange={update}\n          modelField={modelField}\n          computersAvailable={computersAvailable}\n        />\n        <AgentLifecyclePanel name={draft.name} computerEnabled={computersAvailable && draft.computer} />',
      ]],
    },
  ],
}

export default feature
