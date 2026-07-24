# Public repository export

Do not make the existing private repository public.

Its history contains private security reports, remediation plans, agent
instructions, internal product documents, and files that are irrelevant to a
public source distribution. Deleting those files in the latest commit would not
remove them from Git history.

Create the public repository from a history-free, reviewed snapshot after Gate A
has passed:

1. Confirm the private source commit that passed Gate A.
2. Run `npm run public:export -- /absolute/path/to/empty/export-directory`.
3. In the export directory, run:
   - `npm ci`
   - `npm run check:public-tree`
   - `npm run license:check`
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --dir --publish never`
4. Run an approved secret scanner over both the export and the private
   repository's full history. A clean export does not excuse a secret found in
   private history; rotate and investigate every confirmed credential.
5. Complete legal and asset-provenance review.
6. Initialize a new Git repository inside the export, commit the reviewed
   snapshot, and connect it to the new public remote.
7. Configure branch protection, required reviews/checks, CODEOWNERS, maintainer
   2FA, secret scanning with push protection, Dependabot, private vulnerability
   reporting, and protected release environments before changing visibility.
8. Confirm that the new public remote contains only the sanitized root commit.

`public:export` uses `git archive`, so the `export-ignore` policy in
`.gitattributes` is the authoritative list of private-only paths. It refuses a
dirty source tree and a non-empty destination to prevent ambiguous exports.

Never copy `.git`, local environment files, signing material, build output,
private reports, or release credentials into the public repository.
