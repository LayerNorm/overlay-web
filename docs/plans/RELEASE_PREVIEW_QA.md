# Temporary preview isolation QA: string schema

Depends on release-workflow foundation PR #187 at commit
`7efe03e562011bd1f97ef6221b3952fa92500252`. Close this QA PR after acceptance;
do not merge the temporary fixture into main.

The indexed `releasePreviewIsolationQa` table requires a **string** value.
Its paired QA branch requires the incompatible other type in the same column.
The preview-only seed creates one fixture; the internal query
`dev/previewIsolationQa:read` validates its actual stored type.

Acceptance: both PR previews build at once on separate Convex backends, real
sandbox sign-in works, a note created in one is absent in the other, and the
internal queries return their respective incompatible types. Update a PR and
check data preservation/current-head assignment; close it and verify alias,
domain and branch-origin cleanup plus rejection of wildcard fallback.

Lifecycle QA revision A: request a build, then supersede it with revision B.

Lifecycle QA revision B: older revision A must never be aliased.
