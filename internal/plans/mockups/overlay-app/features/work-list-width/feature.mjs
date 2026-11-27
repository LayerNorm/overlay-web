// The Work list sits in the same centered column as the task composer (max-w-4xl, same side gutters), like chat's
// transcript above its composer, so rows no longer run edge to edge and scroll past the narrower composer. Board and
// timeline keep the full width. Rows also lose their divider lines (task rows, agent assignment rows and the loading
// placeholders), which also removes the line under each section, matching the rest of the app. Timeline keeps the full
// width it needs but drops its row lines, header line and task-name column line; the week ticks and today line stay as
// the time scale. Board and Timeline also sit in the composer's column (Board's five columns share it; Timeline scrolls
// sideways inside it), and Organization uses the same side gutters so its edges line up with the other views.
//   MOCKUP_FEATURE=work-list-width node internal/plans/mockups/overlay-app/build.mjs
export default {
  out: 'work-list-width.html',
  title: 'Overlay | Work list width mockup',
  patches: [
    {
      file: 'src/features/work/components/WorkPage.tsx',
      replace: [[
        `    <>
      <WorkList items={visible} byId={byId} today={today} selectedId={selectedId} onOpen={onOpen} />
      {assignmentGroup}
    </>`,
        `    <div className="mx-auto w-full max-w-4xl px-3 sm:px-4">
      <WorkList items={visible} byId={byId} today={today} selectedId={selectedId} onOpen={onOpen} />
      {assignmentGroup}
    </div>`,
      ], [
        'flex h-10 items-center gap-3 border-b border-(--border)/60',
        'flex h-10 items-center gap-3',
      ], [
        'className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden"',
        'className="mx-auto min-h-0 w-full max-w-4xl flex-1 overflow-x-auto overflow-y-hidden"',
      ], [
        '      <div className="min-h-0 flex-1">',
        '      <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 px-3 sm:px-4">',
      ]],
    },
    {
      file: 'src/features/work/components/WorkRow.tsx',
      replace: [['flex h-10 cursor-pointer items-center gap-3 border-b border-(--border)/60 px-6', 'flex h-10 cursor-pointer items-center gap-3 px-6']],
    },
    {
      file: 'src/features/work/components/WorkAssignments.tsx',
      replace: [['flex h-10 cursor-pointer items-center gap-3 border-b border-(--border)/60 px-6', 'flex h-10 cursor-pointer items-center gap-3 px-6']],
    },
    {
      file: 'src/features/work/components/WorkTimeline.tsx',
      replace: [
        ['className="group/row flex border-b border-(--border)/55"', 'className="group/row flex"'],
        ['sticky left-0 z-10 flex shrink-0 items-center gap-2.5 border-r border-(--border) bg-(--background) pr-4', 'sticky left-0 z-10 flex shrink-0 items-center gap-2.5 bg-(--background) pr-4'],
        ['sticky top-0 z-20 flex border-b border-(--border) bg-(--background)', 'sticky top-0 z-20 flex bg-(--background)'],
        ['sticky left-0 z-10 shrink-0 border-r border-(--border) bg-(--background)', 'sticky left-0 z-10 shrink-0 bg-(--background)'],
      ],
    },
    {
      file: 'src/features/work/components/WorkBoard.tsx',
      replace: [['snap-mandatory gap-3.5 px-4 pb-6 pt-4 sm:snap-none sm:px-6', 'snap-mandatory gap-3.5 px-3 pb-6 pt-4 sm:snap-none sm:px-4']],
    },
    {
      file: 'src/features/work/components/OrganizationPage.tsx',
      replace: [['mx-auto flex min-h-full max-w-4xl flex-col items-center px-5 py-10 md:px-8', 'mx-auto flex min-h-full max-w-4xl flex-col items-center px-3 py-10 sm:px-4']],
    },
  ],
}
